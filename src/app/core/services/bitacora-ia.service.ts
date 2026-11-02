import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CapturedPhoto } from './camera.service';
import { PropuestaBitacoraIA } from '../models/bitacora-ia.model';
import { blobABase64 } from '../../shared/utils/base64.util';

/**
 * DF1-A (PROMPT 129) — cliente de la edge `bitacora-ia` (SGC, ya desplegada en
 * el Supabase de dev por la ronda paralela PROMPT 128). Fotos + nota de voz →
 * propuesta de los 12 pasos del parte diario con confianza por campo. El
 * usuario SIEMPRE revisa y confirma — esta propuesta nunca se envía sola, el
 * `submit()` real de `parte.ts` sigue siendo el único camino a
 * `crear_bitacora_app`.
 *
 * Solo-online a propósito (DF-05 simplificado): sin red, el botón "Entender y
 * llenar el parte" se deshabilita con un aviso — las fotos/la voz YA están en
 * el borrador autosave de `parte.ts`, nada se pierde; el usuario reintenta
 * cuando vuelva la señal. No se construyó un job de outbox para esto porque
 * el outbox existente asume "subir foto a Storage → RPC de negocio", y esta
 * llamada no escribe ningún dato de negocio — es una lectura de apoyo.
 */
@Injectable({ providedIn: 'root' })
export class BitacoraIaService {
  private supabase = inject(SupabaseService);

  async entenderParte(input: {
    proyectoId: string;
    fecha: string;
    fotos: CapturedPhoto[];
    audio: Blob | null;
  }): Promise<PropuestaBitacoraIA> {
    const fotos = await Promise.all(
      input.fotos.map(async (f) => ({ data: await blobABase64(f.blob), mime: f.blob.type || 'image/jpeg' })),
    );
    const audio = input.audio
      ? { data: await blobABase64(input.audio), mime: input.audio.type || 'audio/webm' }
      : undefined;

    const { data, error } = await this.supabase.client.functions.invoke('bitacora-ia', {
      body: { proyecto_id: input.proyectoId, fecha: input.fecha, fotos, audio },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed?.error) return { ok: false, error: parsed.error, error_code: parsed.error_code };
        } catch {
          /* ignore */
        }
      }
      return { ok: false, error: 'No se pudo entender el parte. Llénalo a mano.' };
    }
    return data as PropuestaBitacoraIA;
  }

  /** Marca la propuesta como aceptada (se usó para llenar el parte) o descartada. Best-effort. */
  async resolverPropuesta(propuestaId: string, estado: 'aceptada' | 'descartada', bitacoraId?: string): Promise<void> {
    try {
      await this.supabase.client
        .from('bitacora_ia_propuestas')
        .update({ estado, bitacora_id: bitacoraId ?? null, resuelta_en: new Date().toISOString() })
        .eq('id', propuestaId);
    } catch {
      /* métrica, nunca bloquea al usuario */
    }
  }
}
