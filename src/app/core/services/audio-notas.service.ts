import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError } from '../sync/sync.service';

/** Z23 — tipos de entidad que aceptan notas de voz (espeja el enum del SGC web). */
export type AudioEntidadTipo =
  | 'bitacora'
  | 'incidente'
  | 'accidente'
  | 'reporte_semanal'
  | 'preuso'
  | 'mantenimiento'
  | 'ruta'
  | 'checklist'
  | 'traspaso_acta'
  | 'otro';

/** Bucket sugerido por módulo (mismos que usa el SGC web). */
export const AUDIO_BUCKET_FLOTA = 'flota-documentos';

/** Metadatos de un audio para el handler del outbox (sin el blob, va como foto). */
export interface AudioNotaMeta {
  slot: string;
  bucket: string;
  mime: string;
  bytes: number;
}

/** Fila devuelta por `audios_de` (para reproducir en el detalle). */
export interface AudioNota {
  id: string;
  bucket: string;
  path: string;
  duracion_seg: number | null;
  tipo_mime: string | null;
  tamano_bytes: number | null;
  es_prueba: boolean;
  creado_por: string | null;
  created_at: string;
  // AA22 — transcripción automática de la nota de voz (si el proveedor la generó).
  transcripcion?: string | null;
  transcripcion_estado?: string | null; // pendiente | completada | fallida
}

/**
 * Z23 — notas de voz transversales sobre `sgc.audio_notas` (RPC idempotente por
 * path, límite server-side `max_audio_notas`). Contrato del SGC:
 *  - `agregar_audio_nota(p_entidad_tipo, p_entidad_id, p_bucket, p_path, …)`
 *  - `audios_de(p_entidad_tipo, p_entidad_id)` → filas AudioNota
 *  - `max_audio_notas()` → int (default 5)
 *
 * Offline-first: los audios se capturan en el wizard, viajan por el outbox como
 * adjuntos (slot `audio_i`) y `commit()` los registra DESPUÉS de crear la
 * entidad (misma op del handler), usando la ruta ya subida a Storage.
 */
@Injectable({ providedIn: 'root' })
export class AudioNotasService {
  private supabase = inject(SupabaseService);

  /**
   * Construye los adjuntos del outbox (uno por nota, slot `audio_i`) + los
   * metadatos que el handler necesita para `agregar_audio_nota`. Los blobs se
   * suben por la misma maquinaria de fotos; el path se genera de una vez para
   * que los reintentos sean idempotentes.
   */
  buildAttachments(entidadTipo: AudioEntidadTipo, entidadId: string, bucket: string, blobs: Blob[]) {
    const fotos = (blobs ?? []).map((blob, i) => ({
      id: crypto.randomUUID(),
      bucket,
      path: `audio/${entidadTipo}/${entidadId}/${i}-${crypto.randomUUID()}.webm`,
      slot: `audio_${i}`,
      blob,
    }));
    const audios: AudioNotaMeta[] = fotos.map((f, i) => ({
      slot: f.slot,
      bucket,
      mime: blobs[i].type || 'audio/webm',
      bytes: blobs[i].size,
    }));
    return { fotos, audios };
  }

  /**
   * Registra cada nota en `audio_notas` tras crear la entidad (llamar desde el
   * handler del outbox, con los `photoPaths` ya subidos). Idempotente por path.
   */
  async commit(
    entidadTipo: AudioEntidadTipo,
    entidadId: string,
    audios: AudioNotaMeta[] | undefined,
    photoPaths: Record<string, string>,
  ): Promise<void> {
    for (const a of audios ?? []) {
      const path = photoPaths[a.slot];
      if (!path) continue; // el blob no se subió (nota eliminada) → nada que registrar
      const { error } = await this.supabase.client.rpc('agregar_audio_nota', {
        p_entidad_tipo: entidadTipo,
        p_entidad_id: entidadId,
        p_bucket: a.bucket,
        p_path: path,
        p_duracion_seg: null,
        p_tipo_mime: a.mime || 'audio/webm',
        p_tamano_bytes: a.bytes ?? null,
        p_es_prueba: false,
      });
      if (error) throwSyncError(error);
    }
  }

  /** Límite de notas por registro (flota_config.max_audio_notas; default 5). */
  async getLimite(): Promise<number> {
    try {
      const { data, error } = await this.supabase.client.rpc('max_audio_notas');
      if (error) return 5;
      return Number(data) || 5;
    } catch {
      return 5;
    }
  }

  /** Notas ya registradas (para reproducir en el detalle). Online. */
  async list(entidadTipo: AudioEntidadTipo, entidadId: string): Promise<AudioNota[]> {
    const { data, error } = await this.supabase.client.rpc('audios_de', {
      p_entidad_tipo: entidadTipo,
      p_entidad_id: entidadId,
    });
    if (error) return [];
    return (data as AudioNota[]) ?? [];
  }

  /** URL firmada para reproducir una nota (online). */
  async signedUrl(bucket: string, path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }
}
