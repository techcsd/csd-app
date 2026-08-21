import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';

/** AT4 — un usuario elegible como ayudante (resultado de `buscar_usuarios`). */
export interface AyudanteUsuario {
  id: string;
  nombre: string;
  email?: string | null;
}

/** AT4 — tipos de actividad que puntúan y aceptan ayudante. */
export type AyudanteActividad = 'ruta' | 'conduce' | 'echada' | 'inspeccion' | 'reporte_semanal';

const LAST_KEY = 'csd_ultimo_ayudante';

/**
 * AT4 — figura del "ayudante de chofer": el chofer que va acompañado marca a su
 * ayudante en una actividad que puntúa (ruta, conduce, inspección, reporte
 * semanal) para que a ese ayudante también le cuente. Decisión de Xaviel
 * (CONTRATOS): 1 ayudante, suma igual al titular, al crear la actividad.
 *
 * - `buscar`: usa `buscar_usuarios` (devuelve el `usuario_id` que necesita
 *   `marcar_ayudante`); `choferes_activos` no sirve porque devuelve conductor_id.
 * - `marcar`: se llama DENTRO del handler del outbox, DESPUÉS de crear la
 *   actividad (el id de la actividad = el client UUID `payload.id` en ruta/
 *   conduce/inspección/reporte). Best-effort: si falla, no tumba la creación.
 * - "último ayudante": se recuerda localmente para sugerirlo rápido (fricción
 *   mínima: suele ser el mismo varios días).
 */
@Injectable({ providedIn: 'root' })
export class AyudanteService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);

  /** Busca usuarios elegibles como ayudante (por nombre/cédula/email). */
  async buscar(term: string): Promise<AyudanteUsuario[]> {
    const t = term.trim();
    if (t.length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: t });
    if (error) throw new Error(error.message);
    return (data as AyudanteUsuario[]) ?? [];
  }

  /**
   * AT4 — marca a `usuarioId` como ayudante de la actividad. Best-effort: se
   * llama tras crear la actividad; un fallo NO debe tumbar la operación (el
   * ayudante es un extra, no el núcleo). El server valida que el titular no sea
   * su propio ayudante y notifica al ayudante.
   */
  async marcar(tipo: AyudanteActividad, actividadId: string, usuarioId: string): Promise<void> {
    try {
      const { error } = await this.supabase.client.rpc('marcar_ayudante', {
        p_activity_type: tipo,
        p_activity_id: actividadId,
        p_usuario_id: usuarioId,
      });
      if (error) throw new Error(error.message);
    } catch {
      /* best-effort: la actividad ya quedó creada; el ayudante se puede re-marcar. */
    }
  }

  /** Recuerda el último ayudante elegido (sugerencia rápida en el próximo flujo). */
  async recordarUltimo(u: AyudanteUsuario): Promise<void> {
    try {
      await this.store.set(LAST_KEY, JSON.stringify({ id: u.id, nombre: u.nombre }));
    } catch {
      /* best-effort */
    }
  }

  /** El último ayudante elegido, si hay (para ofrecerlo como sugerencia). */
  async ultimo(): Promise<AyudanteUsuario | null> {
    try {
      const raw = await this.store.get(LAST_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw) as { id?: string; nombre?: string };
      return o.id && o.nombre ? { id: o.id, nombre: o.nombre } : null;
    } catch {
      return null;
    }
  }
}
