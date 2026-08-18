import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';
import { Parada } from '../../shared/ui/trayectoria-map/trayectoria-map';

/** AU5/AU7 — recorrido diario consolidado (recorrido_diario_de). */
export interface RecorridoDia {
  usuario_id: string;
  nombre: string | null;
  fecha: string;
  coords: [number, number][];
  polyline: string | null;
  paradas: Parada[];
  puntos: number;
  km: number;
  primer_at: string | null;
  ultimo_at: string | null;
  fuente: 'consolidado' | 'vivo';
}

/** AU5/AJ14 — trayecto consolidado de UNA ruta (ruta_trayecto). */
export interface RutaTrayecto {
  ruta_id: string;
  coords: [number, number][];
  polyline: string | null;
  puntos: number;
  km: number;
  consolidado_at: string | null;
}

/**
 * AU5/AU7 — lecturas de trayectoria/recorrido para el replay del app.
 * Contratos ya desplegados (PROMPT-21): ruta_trayecto(ruta_id) y
 * recorrido_diario_de(usuario_id, fecha) — ambos con coords [lat,lng] y paradas.
 */
@Injectable({ providedIn: 'root' })
export class RecorridoService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  /** AU5 — trayecto de una ruta (para "Ver trayectoria" al completar / en el detalle). */
  async rutaTrayecto(rutaId: string): Promise<RutaTrayecto> {
    const { data, error } = await this.supabase.client.rpc('ruta_trayecto', { p_ruta_id: rutaId });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Partial<RutaTrayecto>;
    return {
      ruta_id: rutaId,
      coords: (d.coords as [number, number][]) ?? [],
      polyline: d.polyline ?? null,
      puntos: d.puntos ?? 0,
      km: d.km ?? 0,
      consolidado_at: d.consolidado_at ?? null,
    };
  }

  /** AU7 — recorrido diario del usuario actual (o de otro, si es flota-elevado). */
  async recorridoDia(fecha: string, usuarioId?: string): Promise<RecorridoDia> {
    const uid = usuarioId ?? this.ctx.profile()?.id;
    if (!uid) throw new Error('Sin usuario.');
    const { data, error } = await this.supabase.client.rpc('recorrido_diario_de', {
      p_usuario_id: uid,
      p_fecha: fecha,
    });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Partial<RecorridoDia>;
    return {
      usuario_id: uid,
      nombre: d.nombre ?? null,
      fecha,
      coords: (d.coords as [number, number][]) ?? [],
      polyline: d.polyline ?? null,
      paradas: (d.paradas as Parada[]) ?? [],
      puntos: d.puntos ?? 0,
      km: d.km ?? 0,
      primer_at: d.primer_at ?? null,
      ultimo_at: d.ultimo_at ?? null,
      fuente: (d.fuente as 'consolidado' | 'vivo') ?? 'vivo',
    };
  }
}
