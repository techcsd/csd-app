import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** AE — un aviso in-app (sgc.notificaciones). */
export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  ruta: string | null;
  leida: boolean;
  created_at: string;
}

/**
 * AE — Lector de avisos in-app (sgc.notificaciones). Hasta ahora las notificaciones
 * (p. ej. "firma pendiente", cierres de compra) solo las consumía la web; esto las
 * trae a la app. RLS: cada quien ve/actualiza SOLO los suyos (usuario_id=auth.uid()).
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private supabase = inject(SupabaseService);

  private _noLeidas = signal(0);
  noLeidas = this._noLeidas.asReadonly();

  /** Últimos avisos del usuario (no leídos primero). Online. */
  async getMisNotificaciones(limit = 50): Promise<Notificacion[]> {
    const { data, error } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, ruta, leida, created_at')
      .order('leida', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const list = (data as Notificacion[]) ?? [];
    this._noLeidas.set(list.filter((n) => !n.leida).length);
    return list;
  }

  /** Cuenta de no leídos (para el badge). Best-effort. */
  async refreshNoLeidas(): Promise<void> {
    const { count, error } = await this.supabase.client
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('leida', false);
    if (!error) this._noLeidas.set(count ?? 0);
  }

  async marcarLeida(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
    this._noLeidas.update((n) => Math.max(0, n - 1));
  }

  async marcarTodasLeidas(): Promise<void> {
    const { error } = await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .eq('leida', false);
    if (error) throw new Error(error.message);
    this._noLeidas.set(0);
  }
}
