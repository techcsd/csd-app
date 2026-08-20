import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SyncService, throwSyncError } from '../sync/sync.service';
import { environment } from '../../../environments/environment';

/** AN6/AQ9 — bucket de mensajería (avatares de grupo + adjuntos). La RLS exige
 *  que la carpeta [1] del path sea la conversación (es_participante). */
const AVATAR_BUCKET = 'sgc-mensajes';

/** AQ9 — límite de tamaño de un adjunto (coincide con el file_size_limit del bucket). */
export const MAX_ADJUNTO_BYTES = 25 * 1024 * 1024;

/** AT16 — bucket público de stickers propios del usuario (path = `{usuario_id}/{uuid}.ext`). */
const STICKERS_BUCKET = 'sgc-stickers';

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

/** AJ5 — un mensaje (listar_mensajes). AN6 añade `tipo` ('texto'|'sistema'). */
export interface Mensaje {
  id: string;
  autor_id: string;
  autor_nombre: string | null;
  contenido: string | null;
  tipo?: string; // 'texto' (default) | 'sistema' | 'sticker' | 'audio' (AV5)
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  archivo_size?: number | null; // AS10 — peso en bytes (conocido para pendientes)
  duracion_seg?: number | null; // AV5 — nota de voz (tipo 'audio')
  created_at: string;
}

/**
 * AX1 — un mensaje aún en el outbox (no confirmado por el server). El hilo lo
 * pinta DESDE la cola durable, así un reload nunca lo borra y su estado real
 * (pending/syncing/error) siempre se ve. `client_id` = id de la op del outbox.
 */
export interface PendienteMsg {
  client_id: string;
  tipo: 'texto' | 'audio' | 'sticker' | 'imagen' | 'archivo';
  contenido: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  duracion_seg: number | null;
  ref: string | null; // sticker
  estado: 'pending' | 'syncing' | 'error';
  error_msg: string | null;
  created_local: number;
  blob: Blob | null; // preview local (audio / imagen) antes de subir
}

/** AV5 — cursores de recibo de un participante (para pintar ✓/✓✓/✓✓azul). */
export interface Recibo {
  usuario_id: string;
  nombre: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
}

/** AV5 — acción de presencia efímera en una conversación. */
export type PresenciaAccion = 'escribiendo' | 'grabando' | 'sticker' | 'nada';

/** AT16 — un sticker. `ref` = ruta de asset empaquetado ('assets/stickers/…') o
 *  path en el bucket público `sgc-stickers`; usar `stickerUrl(ref)` para el <img>. */
export interface Sticker {
  id: string;
  ref: string;
  es_asset: boolean;
}

/** AT16 — un pack de stickers (sistema o propio del usuario). */
export interface StickerPack {
  id: string;
  nombre: string;
  es_sistema: boolean;
  orden: number;
  stickers: Sticker[];
}

/** AN6 — un participante de un grupo (grupo_info). */
export interface GrupoParticipante {
  usuario_id: string;
  nombre: string | null;
  email: string | null;
  rol: 'admin' | 'miembro';
  added_at: string | null;
  es_creador: boolean;
}

/** AN6 — info de un grupo tipo WhatsApp (grupo_info). */
export interface GrupoInfo {
  id: string;
  tipo: string;
  nombre: string | null;
  descripcion: string | null;
  avatar_path: string | null;
  creado_por: string | null;
  created_at: string | null;
  mi_rol: 'admin' | 'miembro' | null;
  participantes: GrupoParticipante[];
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

  /**
   * AQ9 — envía un adjunto (imagen o archivo). El blob sube por outbox al bucket
   * sgc-mensajes (carpeta = conversación, para la RLS `es_participante`); al drenar,
   * el handler pasa el path subido + nombre + mime a enviar_mensaje. Offline-safe e
   * idempotente por client_id. `contenido` opcional (pie de foto).
   */
  async enviarAdjunto(
    conversacionId: string,
    file: { blob: Blob; nombre: string; mime: string },
    contenido?: string | null,
  ): Promise<void> {
    if (file.blob.size > MAX_ADJUNTO_BYTES) {
      throw new Error('El archivo supera el límite de 25 MB.');
    }
    const id = crypto.randomUUID();
    const ext = this.extDe(file.nombre, file.mime);
    const path = `${conversacionId}/${id}${ext ? '.' + ext : ''}`;
    await this.sync.enqueue({
      id,
      tipo_op: 'mensaje_enviar',
      capturado_en: new Date().toISOString(),
      payload: {
        client_id: id,
        conversacion_id: conversacionId,
        contenido: (contenido ?? '').trim() || null,
        archivo_nombre: file.nombre,
        archivo_mime: file.mime,
      },
      fotos: [{ id: crypto.randomUUID(), bucket: AVATAR_BUCKET, path, slot: 'adjunto', blob: file.blob }],
      resumen: { tipo: 'mensaje_enviar', conversacion_id: conversacionId },
    });
  }

  /** Extensión segura para el path del adjunto (del nombre; fallback por mime). */
  private extDe(nombre: string, mime: string): string {
    const fromName = (nombre.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fromName && fromName.length <= 5 && fromName !== nombre.toLowerCase()) return fromName;
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'application/pdf') return 'pdf';
    return '';
  }

  /** URL firmada de un adjunto/avatar (bucket sgc-mensajes, best-effort). */
  adjuntoUrl(path: string | null | undefined): Promise<string | null> {
    return this.avatarUrl(path);
  }

  async marcarLeida(conversacionId: string): Promise<void> {
    try {
      await this.supabase.client.rpc('marcar_conversacion_leida', { p_conversacion_id: conversacionId });
    } catch {
      /* best-effort */
    }
  }

  /** AV5 — marca "recibido en el dispositivo" (cursor de entrega → ✓✓ del otro). */
  async marcarEntregada(conversacionId: string): Promise<void> {
    try {
      await this.supabase.client.rpc('marcar_conversacion_entregada', { p_conversacion_id: conversacionId });
    } catch {
      /* best-effort */
    }
  }

  /** AV5 — cursores de recibo de los DEMÁS participantes (para ✓/✓✓/✓✓azul). */
  async getRecibos(conversacionId: string): Promise<Recibo[]> {
    const { data, error } = await this.supabase.client.rpc('conversacion_recibos', {
      p_conversacion_id: conversacionId,
    });
    if (error) return [];
    return (data as Recibo[]) ?? [];
  }

  /**
   * AV5 — envía una NOTA DE VOZ (tipo 'audio'). El blob sube por outbox al bucket
   * sgc-mensajes (carpeta = conversación, RLS es_participante); al drenar, el handler
   * pasa el path + duración a `enviar_nota_voz`. Offline-safe e idempotente por client_id.
   */
  async enviarNotaVoz(conversacionId: string, blob: Blob, duracionSeg: number, mime = 'audio/webm'): Promise<void> {
    if (blob.size > MAX_ADJUNTO_BYTES) throw new Error('La nota de voz supera el límite de 25 MB.');
    const id = crypto.randomUUID();
    // AW13 — mime BASE (sin ';codecs=…'): el allowlist del bucket lo valida exacto.
    const baseMime = (mime || 'audio/webm').split(';')[0].trim();
    const ext = baseMime.includes('mp4') ? 'm4a' : baseMime.includes('ogg') ? 'ogg' : 'webm';
    const path = `${conversacionId}/${id}.${ext}`;
    await this.sync.enqueue({
      id,
      tipo_op: 'nota_voz_enviar',
      capturado_en: new Date().toISOString(),
      payload: {
        client_id: id,
        conversacion_id: conversacionId,
        duracion_seg: Math.max(0, Math.round(duracionSeg)),
        archivo_mime: baseMime,
      },
      fotos: [{ id: crypto.randomUUID(), bucket: AVATAR_BUCKET, path, slot: 'audio', blob }],
      resumen: { tipo: 'nota_voz_enviar', conversacion_id: conversacionId },
    });
  }

  /**
   * AX1 — mensajes de esta conversación aún en el outbox (pending/syncing/error),
   * mapeados para pintarlos en el hilo. La fuente es la cola durable (Dexie), no
   * una lista optimista en memoria → un envío posterior JAMÁS borra un pendiente.
   */
  async pendientesDe(conversacionId: string): Promise<PendienteMsg[]> {
    const rows = await this.sync.opsMensajeria(conversacionId);
    return rows.map(({ op, fotos }) => {
      const p = op.payload;
      const estado: PendienteMsg['estado'] =
        op.estado === 'error' ? 'error' : op.estado === 'syncing' ? 'syncing' : 'pending';
      const mime = (p['archivo_mime'] as string | undefined) ?? null;
      let tipo: PendienteMsg['tipo'] = 'texto';
      if (op.tipo_op === 'nota_voz_enviar') tipo = 'audio';
      else if (op.tipo_op === 'sticker_enviar') tipo = 'sticker';
      else if (mime) tipo = mime.startsWith('image/') ? 'imagen' : 'archivo';
      const blob = fotos.find((f) => f.slot === 'audio' || f.slot === 'adjunto')?.blob ?? null;
      return {
        client_id: op.id,
        tipo,
        contenido: (p['contenido'] as string | null) ?? null,
        archivo_nombre: (p['archivo_nombre'] as string | null) ?? null,
        archivo_mime: mime,
        duracion_seg: (p['duracion_seg'] as number | null) ?? null,
        ref: (p['ref'] as string | null) ?? null,
        estado,
        error_msg: op.error_msg ?? null,
        created_local: op.created_local,
        blob,
      };
    });
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

  // ── AN6 — Grupos tipo WhatsApp (info + gestión) ─────────────────────────────
  /** Crea un grupo (el creador queda admin) → id del grupo. */
  async crearGrupo(nombre: string, participantes: string[]): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_grupo', {
      p_nombre: nombre,
      p_participantes: participantes,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Info del grupo (meta + participantes con rol). Solo participantes. */
  async grupoInfo(conversacionId: string): Promise<GrupoInfo> {
    const { data, error } = await this.supabase.client.rpc('grupo_info', { p_conv: conversacionId });
    if (error) throw new Error(error.message);
    return data as GrupoInfo;
  }

  /** Edita nombre/descripción del grupo (solo admin del grupo). */
  async grupoEditar(conversacionId: string, nombre: string, descripcion: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_editar', {
      p_conv: conversacionId,
      p_nombre: nombre,
      p_descripcion: descripcion,
    });
    if (error) throw new Error(error.message);
  }

  /** Agrega un participante (solo admin). */
  async grupoAgregar(conversacionId: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_agregar', {
      p_conv: conversacionId,
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
  }

  /** Quita un participante (solo admin; no al creador). */
  async grupoQuitar(conversacionId: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_quitar', {
      p_conv: conversacionId,
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
  }

  /** Promueve/degrada admin (solo admin). */
  async grupoPromover(conversacionId: string, usuarioId: string, admin: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_promover', {
      p_conv: conversacionId,
      p_usuario_id: usuarioId,
      p_admin: admin,
    });
    if (error) throw new Error(error.message);
  }

  /** Salir del grupo (cualquier miembro). */
  async grupoSalir(conversacionId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('grupo_salir', { p_conv: conversacionId });
    if (error) throw new Error(error.message);
  }

  /**
   * Sube el avatar del grupo al bucket sgc-mensajes (carpeta = conversación, para
   * que la RLS `es_participante` lo permita) con un nombre ÚNICO por cambio (no
   * upsert → no hace falta política UPDATE) y fija el path con grupo_set_avatar.
   */
  async cambiarAvatarGrupo(conversacionId: string, blob: Blob): Promise<void> {
    const path = `${conversacionId}/avatar-${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.client.storage
      .from(AVATAR_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('grupo_set_avatar', {
      p_conv: conversacionId,
      p_path: path,
    });
    if (error) throw new Error(error.message);
  }

  /** URL firmada del avatar del grupo (bucket sgc-mensajes, best-effort). */
  async avatarUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /**
   * QA-20 — Realtime: notifica en cada INSERT en sgc.mensajes. Cada suscriptor
   * (lista, hilo, home) obtiene su PROPIO canal → coexisten sin pisarse (antes un
   * único canal compartido con `desuscribir()` global hacía que se robaran la
   * suscripción). Devuelve la función para desuscribirse (llamar en ngOnDestroy).
   * El hilo pasa `conversacionId` para filtrar server-side; lista/home escuchan
   * todos los mensajes (cada uno con su propio canal).
   */
  suscribir(onChange: () => void, conversacionId?: string): () => void {
    const filtro: { event: 'INSERT'; schema: string; table: string; filter?: string } = {
      event: 'INSERT',
      schema: 'sgc',
      table: 'mensajes',
    };
    if (conversacionId) filtro.filter = `conversacion_id=eq.${conversacionId}`;
    const channel = this.supabase.client
      .channel(`mensajes-app-${crypto.randomUUID()}`)
      .on('postgres_changes', filtro, () => onChange())
      .subscribe();
    return () => {
      void this.supabase.client.removeChannel(channel);
    };
  }

  /**
   * AV5 — canal EFÍMERO de presencia/typing por conversación (broadcast, sin BD).
   * Mismo nombre/payload que la web: `chat:presencia:{id}`, evento 'estado'
   * { usuario_id, nombre, accion, at }. Devuelve { emitir, cerrar }.
   */
  presencia(
    conversacionId: string,
    yo: { id: string; nombre: string },
    onEstado: (p: { usuario_id: string; nombre: string; accion: PresenciaAccion; at: number }) => void,
  ): { emitir: (accion: PresenciaAccion) => void; cerrar: () => void } {
    const channel = this.supabase.client.channel(`chat:presencia:${conversacionId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'estado' }, (msg) => {
        const p = (msg as { payload?: Record<string, unknown> }).payload;
        if (p && p['usuario_id'] && p['usuario_id'] !== yo.id) {
          onEstado({
            usuario_id: p['usuario_id'] as string,
            nombre: (p['nombre'] as string) ?? '',
            accion: (p['accion'] as PresenciaAccion) ?? 'nada',
            at: (p['at'] as number) ?? Date.now(),
          });
        }
      })
      .subscribe();
    return {
      emitir: (accion: PresenciaAccion) => {
        void channel.send({
          type: 'broadcast',
          event: 'estado',
          payload: { usuario_id: yo.id, nombre: yo.nombre, accion, at: Date.now() },
        });
      },
      cerrar: () => {
        void this.supabase.client.removeChannel(channel);
      },
    };
  }

  // ── AT16 — Stickers (mismo contrato que la web) ─────────────────────────────
  /**
   * URL usable en un <img src> para una ref de sticker. Un asset empaquetado
   * ('assets/…') se sirve tal cual; el resto es un path del bucket público
   * `sgc-stickers` (no requiere firmar).
   */
  stickerUrl(ref: string): string {
    return ref.startsWith('assets/')
      ? ref
      : `${environment.supabaseUrl}/storage/v1/object/public/${STICKERS_BUCKET}/${ref}`;
  }

  /** Packs de stickers del usuario (sistema + propios) con sus stickers. */
  async getMisStickers(): Promise<StickerPack[]> {
    const { data, error } = await this.supabase.client.rpc('mis_stickers');
    if (error) throw new Error(error.message);
    return (data as StickerPack[]) ?? [];
  }

  /** Refs de los stickers usados más recientemente (más reciente primero). */
  async getStickersRecientes(limite = 24): Promise<string[]> {
    const { data, error } = await this.supabase.client.rpc('stickers_recientes', { p_limite: limite });
    if (error) throw new Error(error.message);
    return ((data as { ref: string; used_at: string }[]) ?? []).map((r) => r.ref);
  }

  /**
   * Envía un sticker como mensaje (tipo 'sticker', ref en `archivo_path`).
   * Offline-safe por outbox (idempotente por client_id); el handler hace el INSERT
   * directo (la RLS `mensajes: insert` lo permite al ser participante) y registra
   * la ref como reciente. Realtime lo entrega como cualquier otro mensaje.
   */
  async enviarSticker(conversacionId: string, ref: string): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'sticker_enviar',
      capturado_en: new Date().toISOString(),
      payload: { client_id: id, conversacion_id: conversacionId, ref },
      fotos: [],
      resumen: { tipo: 'sticker_enviar', conversacion_id: conversacionId },
    });
  }

  /**
   * Sube una imagen como sticker propio al bucket público `sgc-stickers` (primer
   * segmento del path = id del usuario, exigido por la RLS de Storage) y la
   * registra vía `agregar_sticker`. Acción online (crear un sticker no es de campo).
   */
  async subirSticker(usuarioId: string, file: { blob: Blob; nombre: string; mime: string }, packId?: string): Promise<void> {
    const ext = (file.nombre.split('.').pop() || (file.mime.split('/').pop() ?? 'webp')).toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${usuarioId}/${crypto.randomUUID()}.${ext || 'webp'}`;
    const { error: upErr } = await this.supabase.client.storage
      .from(STICKERS_BUCKET)
      .upload(path, file.blob, { upsert: false, contentType: file.mime });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('agregar_sticker', {
      p_storage_path: path,
      p_pack_id: packId ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Elimina un sticker propio. */
  async eliminarSticker(stickerId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_sticker', { p_sticker_id: stickerId });
    if (error) throw new Error(error.message);
  }

  /** AV4 — crea un pack de stickers propio → id del pack. */
  async crearPack(nombre: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_pack_sticker', { p_nombre: nombre });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** AV4 — renombra un pack propio. */
  async renombrarPack(packId: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('renombrar_pack_sticker', { p_pack_id: packId, p_nombre: nombre });
    if (error) throw new Error(error.message);
  }

  /** AV4 — elimina un pack propio (sus stickers quedan sin pack / se limpian server-side). */
  async eliminarPack(packId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_pack_sticker', { p_pack_id: packId });
    if (error) throw new Error(error.message);
  }

  /** AV4 — mueve un sticker propio a otro pack propio. */
  async moverSticker(stickerId: string, packId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('mover_sticker', { p_sticker_id: stickerId, p_pack_id: packId });
    if (error) throw new Error(error.message);
  }

  /** AV4 — guarda un sticker RECIBIDO (de otro) a mis stickers (pack dado o "Guardados"). */
  async guardarSticker(ref: string, packId?: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('guardar_sticker', {
      p_ref: ref,
      p_pack_id: packId ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  private registerHandler(): void {
    if (this.registered) return;
    this.registered = true;
    // AT16 — sticker: INSERT directo (tipo 'sticker'); idempotente por client_msg_id.
    this.sync.register('sticker_enviar', async (payload) => {
      // autor_id debe ser auth.uid() (RLS `mensajes: insert`); lo leemos de la sesión local.
      const yo = (await this.supabase.client.auth.getSession()).data.session?.user?.id ?? null;
      const { error } = await this.supabase.client.from('mensajes').insert({
        conversacion_id: payload['conversacion_id'],
        autor_id: yo,
        contenido: null,
        archivo_path: payload['ref'],
        archivo_mime: 'image/sticker',
        tipo: 'sticker',
        client_msg_id: payload['client_id'],
      });
      // 23505 = ya insertado (reintento del outbox); lo tratamos como éxito.
      if (error && (error as { code?: string }).code !== '23505') throwSyncError(error);
      // Recientes es una conveniencia: best-effort, no bloquea el envío.
      try {
        await this.supabase.client.rpc('registrar_sticker_reciente', { p_ref: payload['ref'] });
      } catch {
        /* best-effort */
      }
    });
    // AV5 — nota de voz: SyncService sube el audio a sgc-mensajes (slot 'audio')
    // y nos pasa su path; llamamos enviar_nota_voz (idempotente por client_id).
    this.sync.register('nota_voz_enviar', async (payload, photoPaths) => {
      const archivoPath = photoPaths?.['audio'] ?? null;
      if (!archivoPath) throwSyncError(new Error('Falta el audio de la nota de voz.'));
      const { error } = await this.supabase.client.rpc('enviar_nota_voz', {
        p_conversacion_id: payload['conversacion_id'],
        p_archivo_path: archivoPath,
        p_duracion_seg: payload['duracion_seg'] ?? 0,
        p_archivo_mime: payload['archivo_mime'] ?? 'audio/webm',
        p_client_id: payload['client_id'],
      });
      if (error) throwSyncError(error);
    });
    this.sync.register('mensaje_enviar', async (payload, photoPaths) => {
      // AQ9 — si el mensaje llevaba adjunto, SyncService ya lo subió a sgc-mensajes
      // y nos pasa su path en `photoPaths['adjunto']`.
      const archivoPath = photoPaths?.['adjunto'] ?? (payload['archivo_path'] as string | null) ?? null;
      const { error } = await this.supabase.client.rpc('enviar_mensaje', {
        p_conversacion_id: payload['conversacion_id'],
        p_contenido: payload['contenido'] ?? null,
        p_archivo_path: archivoPath,
        p_archivo_nombre: payload['archivo_nombre'] ?? null,
        p_archivo_mime: payload['archivo_mime'] ?? null,
        p_client_id: payload['client_id'],
      });
      if (error) throwSyncError(error);
    });
  }
}
