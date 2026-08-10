import { inject, Injectable } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { SyncService, throwSyncError } from '../sync/sync.service';

/** AJ5 — una conversación (listar_conversaciones). Mismo modelo que la web. */
export interface Conversacion {
  id: string;
  tipo: string; // 'directa' | 'grupo'
  nombre: string | null;
  ultimo_mensaje: string | null;
  ultimo_at: string | null;
  no_leidos: number;
  otro_usuario_id: string | null;
}

/** AJ5 — un mensaje (listar_mensajes). */
export interface Mensaje {
  id: string;
  autor_id: string;
  autor_nombre: string | null;
  contenido: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  created_at: string;
}

/**
 * AJ5 — mensajería de la app sobre el MISMO modelo de la web (schema sgc, tabla
 * mensajes + RPCs). Envío offline por outbox (idempotente por client_id), realtime
 * por Supabase, badge de no-leídos. No crea un chat paralelo.
 */
@Injectable({ providedIn: 'root' })
export class MensajesService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);
  private channel: RealtimeChannel | null = null;
  private registered = false;

  constructor() {
    this.registerHandler();
  }

  async listarConversaciones(): Promise<Conversacion[]> {
    const { data, error } = await this.supabase.client.rpc('listar_conversaciones');
    if (error) throw new Error(error.message);
    return (data as Conversacion[]) ?? [];
  }

  async listarMensajes(conversacionId: string, before?: string | null, limit = 30): Promise<Mensaje[]> {
    const { data, error } = await this.supabase.client.rpc('listar_mensajes', {
      p_conversacion_id: conversacionId,
      p_before: before ?? null,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    // El RPC devuelve DESC (más nuevo primero); la vista los pinta ascendente.
    return ((data as Mensaje[]) ?? []).slice().reverse();
  }

  /** Envía un mensaje de texto. Offline-safe por outbox (idempotente por client_id). */
  async enviarMensaje(conversacionId: string, contenido: string): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'mensaje_enviar',
      capturado_en: new Date().toISOString(),
      payload: { client_id: id, conversacion_id: conversacionId, contenido },
      fotos: [],
      resumen: { tipo: 'mensaje_enviar', conversacion_id: conversacionId },
    });
  }

  async marcarLeida(conversacionId: string): Promise<void> {
    try {
      await this.supabase.client.rpc('marcar_conversacion_leida', { p_conversacion_id: conversacionId });
    } catch {
      /* best-effort */
    }
  }

  async contarNoLeidos(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('contar_mensajes_no_leidos');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** Crea (o reutiliza) una conversación directa con otro usuario → id. */
  async crearConversacionDirecta(otroUsuarioId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_conversacion_directa', { p_otro: otroUsuarioId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Realtime: notifica en cada INSERT en sgc.mensajes (lista/hilo se recargan). */
  suscribir(onChange: () => void): void {
    this.desuscribir();
    this.channel = this.supabase.client
      .channel('mensajes-app')
      .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'mensajes' }, () => onChange())
      .subscribe();
  }

  desuscribir(): void {
    if (this.channel) {
      void this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }
  }

  private registerHandler(): void {
    if (this.registered) return;
    this.registered = true;
    this.sync.register('mensaje_enviar', async (payload) => {
      const { error } = await this.supabase.client.rpc('enviar_mensaje', {
        p_conversacion_id: payload['conversacion_id'],
        p_contenido: payload['contenido'] ?? null,
        p_archivo_path: null,
        p_archivo_nombre: null,
        p_archivo_mime: null,
        p_client_id: payload['client_id'],
      });
      if (error) throwSyncError(error);
    });
  }
}
