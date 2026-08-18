import { inject, Injectable } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { EstadoChofer } from './chofer-estado.service';

/** AF27 — estado + última posición de un chofer (para el mapa de Seguimiento). */
export interface ChoferSeguimiento {
  usuario_id: string;
  conductor_id: string;
  nombre: string;
  estado: EstadoChofer;
  otros_texto: string | null;
  almuerzo_inicio: string | null;
  desde: string | null;
  lat: number | null;
  lng: number | null;
  capturado_en: string | null;
}

/** AF27 — ruta activa (en curso) para el panel de Seguimiento. */
export interface RutaActivaSeguimiento {
  id: string;
  destino: string | null;
  origen: string | null;
  placa: string | null;
  marca: string | null; // AT9
  modelo: string | null; // AT9
  color: string | null; // AT9
  conductor_nombre: string | null;
  paradas_total: number;
  paradas_entregadas: number;
}

/**
 * AF27 — datos para la vista Seguimiento del jefe de flota (app). Combina
 * `choferes_estado()` + `chofer_ultima_posicion` (RLS: solo flota-elevado/tecnología)
 * y suscribe el canal realtime de la última posición para el mapa en vivo.
 */
@Injectable({ providedIn: 'root' })
export class SeguimientoService {
  private supabase = inject(SupabaseService);
  private channel: RealtimeChannel | null = null;

  /** Lista de choferes con estado + última posición. AS1 — además incluye a quien
   *  comparte ubicación sin ser chofer (p. ej. Misael, jefe de flota) vía
   *  `otros_rastreados()`, para que también aparezca en el mapa. */
  async choferes(): Promise<ChoferSeguimiento[]> {
    const [estadoRes, otrosRes, posRes] = await Promise.all([
      this.supabase.client.rpc('choferes_estado'),
      this.supabase.client.rpc('otros_rastreados').then((r) => r, () => ({ data: [], error: null })),
      this.supabase.client
        .from('chofer_ultima_posicion')
        .select('usuario_id, lat, lng, capturado_en'),
    ]);
    if (estadoRes.error) throw new Error(estadoRes.error.message);
    const posMap = new Map<string, { lat: number; lng: number; capturado_en: string }>();
    for (const p of (posRes.data as Array<Record<string, unknown>>) ?? []) {
      posMap.set(p['usuario_id'] as string, {
        lat: Number(p['lat']),
        lng: Number(p['lng']),
        capturado_en: p['capturado_en'] as string,
      });
    }
    // AS1 — une choferes + otros rastreados (evitando duplicar por usuario_id).
    const filas = [
      ...((estadoRes.data as Array<Record<string, unknown>>) ?? []),
      ...((otrosRes.data as Array<Record<string, unknown>>) ?? []),
    ];
    const vistos = new Set<string>();
    return filas
      .filter((r) => {
        const id = r['usuario_id'] as string;
        if (vistos.has(id)) return false;
        vistos.add(id);
        return true;
      })
      .map((r) => {
      const pos = posMap.get(r['usuario_id'] as string);
      return {
        usuario_id: r['usuario_id'] as string,
        conductor_id: r['conductor_id'] as string,
        nombre: r['nombre'] as string,
        estado: (r['estado'] as EstadoChofer) ?? 'inactivo',
        otros_texto: (r['otros_texto'] as string) ?? null,
        almuerzo_inicio: (r['almuerzo_inicio'] as string) ?? null,
        desde: (r['desde'] as string) ?? null,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        capturado_en: pos?.capturado_en ?? null,
      };
    });
  }

  /** Rutas en curso (activas) para el panel. */
  async rutasActivas(): Promise<RutaActivaSeguimiento[]> {
    const { data, error } = await this.supabase.client.rpc('rutas_activas_y_hoy');
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? [])
      .filter((r) => r['seccion'] === 'activa')
      .map((r) => ({
        id: r['id'] as string,
        destino: (r['destino'] as string) ?? null,
        origen: (r['origen'] as string) ?? null,
        placa: (r['placa'] as string) ?? null,
        marca: (r['marca'] as string) ?? null,
        modelo: (r['modelo'] as string) ?? null,
        color: (r['color'] as string) ?? null,
        conductor_nombre: (r['conductor_nombre'] as string) ?? null,
        paradas_total: (r['paradas_total'] as number) ?? 0,
        paradas_entregadas: (r['paradas_entregadas'] as number) ?? 0,
      }));
  }

  /** AJ14 — breadcrumb EN VIVO de una ruta activa (puntos del día) para dibujar la
   *  línea del recorrido en el mapa. Best-effort (vacío si no hay puntos/permiso). */
  async rutaBreadcrumb(rutaId: string): Promise<[number, number][]> {
    const { data, error } = await this.supabase.client.rpc('ruta_breadcrumb_vivo', { p_ruta_id: rutaId });
    if (error) return [];
    const raw = ((data as [number, number][]) ?? []).filter((p) => Array.isArray(p) && p.length === 2);
    // QA-34: descarta puntos fuera de RD (lat 17..20, lng -72..-68). Además detecta
    // un [lng,lat] invertido (todos caerían fuera) sin tocar el happy path.
    const dentro = raw.filter(
      ([lat, lng]) => lat >= 17 && lat <= 20 && lng >= -72 && lng <= -68,
    );
    if (raw.length && !dentro.length) {
      console.warn(
        '[seguimiento] rutaBreadcrumb: todos los puntos fuera de RD (¿[lng,lat] invertido?), descartados.',
      );
    }
    return dentro;
  }

  /** AS1 — breadcrumb EN VIVO de un CHOFER (últimas ~3 h), independiente de si hay
   *  ruta formal. Es la "línea que sigue las calles" del tracking continuo. */
  async choferBreadcrumb(usuarioId: string): Promise<[number, number][]> {
    const { data, error } = await this.supabase.client.rpc('chofer_breadcrumb_vivo', {
      p_usuario_id: usuarioId,
    });
    if (error) return [];
    const raw = ((data as [number, number][]) ?? []).filter((p) => Array.isArray(p) && p.length === 2);
    return raw.filter(([lat, lng]) => lat >= 17 && lat <= 20 && lng >= -72 && lng <= -68);
  }

  /** Suscribe el realtime de la última posición; llama a `onChange` en cada update. */
  suscribir(onChange: () => void): void {
    this.desuscribir();
    this.channel = this.supabase.client
      .channel('seguimiento-posiciones')
      .on(
        'postgres_changes',
        { event: '*', schema: 'sgc', table: 'chofer_ultima_posicion' },
        () => onChange(),
      )
      .subscribe();
  }

  desuscribir(): void {
    if (this.channel) {
      void this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
