import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { NotifSoundService } from './notif-sound.service';

/** AE — un aviso in-app (sgc.notificaciones). */
export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  ruta: string | null;
  leida: boolean;
  created_at: string;
  // AQ1/AQ6 — deep-link a la entidad asociada (echada, conduce, ruta, versión…).
  referencia_id?: string | null;
  referencia_tipo?: string | null;
}

/**
 * AE — Lector de avisos in-app (sgc.notificaciones). Hasta ahora las notificaciones
 * (p. ej. "firma pendiente", cierres de compra) solo las consumía la web; esto las
 * trae a la app. RLS: cada quien ve/actualiza SOLO los suyos (usuario_id=auth.uid()).
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private supabase = inject(SupabaseService);
  private sound = inject(NotifSoundService);

  private _noLeidas = signal(0);
  noLeidas = this._noLeidas.asReadonly();

  /**
   * AM4 — tick que incrementa con CADA aviso nuevo que llega por realtime. Las
   * pantallas de datos vivos (Pendiente entrega, Mis rutas, Por confirmar…) lo
   * observan para refetchear al instante cuando el server notifica un cambio
   * (p. ej. una transferencia aceptada avisa a emisor Y receptor con tipo
   * 'transporte'), sin depender de que el usuario vuelva a foreground.
   */
  private _tick = signal(0);
  tick = this._tick.asReadonly();
  /** Tipo del último aviso recibido por realtime (para filtrar reacciones). */
  private _lastTipo = signal<string | null>(null);
  lastTipo = this._lastTipo.asReadonly();

  /** Últimos avisos del usuario (no leídos primero). Online. */
  async getMisNotificaciones(limit = 50): Promise<Notificacion[]> {
    const { data, error } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, ruta, leida, created_at, referencia_id, referencia_tipo')
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

  /** AF6 — eliminar un aviso (swipe/botón). RLS: solo los propios. */
  async eliminar(id: string, eraNoLeida: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('notificaciones').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (eraNoLeida) this._noLeidas.update((n) => Math.max(0, n - 1));
  }

  /**
   * AM4 — realtime de avisos: cada INSERT en sgc.notificaciones del usuario actual
   * refresca el badge de no leídos y bombea `tick`/`lastTipo`. Un solo canal global
   * (idempotente): sirve a todas las pantallas vivas que observan `tick`. Se activa
   * tras el login (app.ts) y se mantiene mientras la sesión esté abierta.
   */
  private canal: { unsubscribe: () => void } | null = null;
  async iniciarRealtime(): Promise<void> {
    if (this.canal) return;
    const { data } = await this.supabase.client.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    const channel = this.supabase.client
      .channel(`notificaciones-app-${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'sgc', table: 'notificaciones', filter: `usuario_id=eq.${uid}` },
        (payload: { new?: { tipo?: string } }) => {
          this._lastTipo.set(payload?.new?.tipo ?? null);
          this._tick.update((n) => n + 1);
          void this.refreshNoLeidas().catch(() => {});
          // AQ1 — con la app abierta, un aviso nuevo suena sutil (tipo WhatsApp).
          this.sound.chime();
        },
      )
      .subscribe();
    this.canal = { unsubscribe: () => void this.supabase.client.removeChannel(channel) };
  }
  detenerRealtime(): void {
    this.canal?.unsubscribe();
    this.canal = null;
  }

  /** AF6 — "borrar todas": elimina todos los avisos del usuario (RLS acota a los suyos). */
  async eliminarTodas(): Promise<void> {
    const { error } = await this.supabase.client
      .from('notificaciones')
      .delete()
      .not('id', 'is', null); // RLS limita a usuario_id = auth.uid()
    if (error) throw new Error(error.message);
    this._noLeidas.set(0);
  }
}

/**
 * AF6 — traduce la `ruta` almacenada (a menudo una ruta WEB de SGC) a una ruta
 * válida de la app. Las notificaciones se generan compartidas con la web, así que
 * sus rutas apuntan al router web; sin traducir, el tap caía al fallback → home.
 * Reutilizable por el deep-link del tap push (AF7).
 */
export function notifAppRoute(n: {
  tipo: string;
  ruta: string | null;
  referencia_id?: string | null;
  referencia_tipo?: string | null;
}): string {
  const r = (n.ruta ?? '').trim();
  // Firma de recepción pendiente → bandeja "Por firmar" (aunque venga sin ruta).
  if (n.tipo === 'firma') return '/transporte/por-firmar';
  // AU1 — recordatorio al DESPACHANTE (tipo 'conduce_firma') → su bandeja de firma.
  // La web manda ruta '/transporte/por-firmar' (que en la app es la del RECEPTOR),
  // así que aquí se mapea por tipo a la bandeja correcta del despachante.
  if (n.tipo === 'conduce_firma') return '/transporte/conduces-por-firmar';
  // AQ1 — versión publicada → pantalla de actualización (deep-link del push de versión).
  if (n.tipo === 'version_publicada' || n.referencia_tipo === 'version' || r.startsWith('/actualizar')) {
    return '/actualizar';
  }
  // AQ6 — consumo anormal → detalle de LA echada (no la bandeja genérica de avisos).
  // El id viene en referencia_id o embebido en la ruta web (?echada=<uuid>).
  const echadaId =
    n.referencia_tipo === 'echada' && n.referencia_id
      ? n.referencia_id
      : r.match(/[?&]echada=([0-9a-fA-F-]{36})/)?.[1] ?? null;
  if (echadaId) return `/transporte/echada/${echadaId}`;
  if (!r) return '/home';
  // Reporte semanal: web /flota/reporte-semanal → app /transporte/reporte-semanal.
  if (r.startsWith('/flota/reporte-semanal')) return '/transporte/reporte-semanal';
  // Resto de alertas de flota (consumo, mantenimiento, odómetro) → bandeja de avisos.
  if (r.startsWith('/flota')) return '/transporte/avisos';
  // Requisiciones/compras (web) → mis solicitudes en la app.
  if (r.startsWith('/bitacora/solicitudes') || r.startsWith('/compras') || r.startsWith('/requisiciones')) {
    return '/solicitudes/mis';
  }
  // Rutas que ya coinciden con el router de la app.
  if (
    r.startsWith('/transporte') ||
    r.startsWith('/inventario') ||
    r.startsWith('/proyectos') ||
    r.startsWith('/bitacora') ||
    r.startsWith('/solicitudes') ||
    r.startsWith('/notas') ||
    r.startsWith('/tareas') ||
    r.startsWith('/mensajes')
  ) {
    return r;
  }
  return '/home';
}
