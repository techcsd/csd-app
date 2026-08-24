import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompaRespuesta, Propuesta } from '../models/compa.model';

/**
 * FASE 4 "Compa" — cliente del asistente de IA. Reutiliza la edge `assistant`
 * (ya desplegada; NO hay backend nuevo). El JWT del usuario lo adjunta
 * supabase-js al invocar, así el asistente hereda sus permisos server-side.
 *
 * ONLINE-only (asistente en vivo, sin outbox). En error de edge NO lanza: devuelve
 * una respuesta sintética amable para que el UI la pinte como una burbuja del
 * asistente (nunca un crash/toast).
 */
@Injectable({ providedIn: 'root' })
export class CompaService {
  private supabase = inject(SupabaseService);

  /**
   * Envía un mensaje al asistente y devuelve el turno de respuesta. En error de
   * edge devuelve una respuesta sintética (mensaje amable según el status) para
   * pintarla como burbuja del asistente.
   */
  async enviar(mensaje: string, conversacionId: string | null): Promise<CompaRespuesta> {
    try {
      const { data, error } = await this.supabase.client.functions.invoke('assistant', {
        body: { mensaje, conversacion_id: conversacionId },
      });
      if (error) {
        return this.errorComoRespuesta(error, conversacionId);
      }
      const r = (data ?? {}) as Partial<CompaRespuesta>;
      return {
        conversacion_id: r.conversacion_id ?? conversacionId,
        respuesta: (r.respuesta && String(r.respuesta)) || 'No recibí una respuesta. Intenta de nuevo.',
        herramientas: Array.isArray(r.herramientas) ? r.herramientas : [],
        propuesta: r.propuesta ?? null,
      };
    } catch (e) {
      return this.errorComoRespuesta(e, conversacionId);
    }
  }

  /**
   * Ejecuta una propuesta preparada (v2): reenvía el objeto VERBATIM en
   * `{ ejecutar }`. El móvil NUNCA ejecuta la acción; solo la confirma. En error
   * devuelve un mensaje amable con `ejecutado: false`.
   */
  async ejecutar(
    propuesta: Propuesta,
    conversacionId: string | null,
  ): Promise<{ respuesta: string; ejecutado: boolean }> {
    try {
      const { data, error } = await this.supabase.client.functions.invoke('assistant', {
        body: { ejecutar: propuesta, conversacion_id: conversacionId },
      });
      if (error) {
        const body = await this.readEdgeError(error);
        const status = this.statusDe(error);
        return { respuesta: this.mensajeAmable(status, body?.error), ejecutado: false };
      }
      const r = (data ?? {}) as { respuesta?: string; ejecutado?: boolean };
      return {
        respuesta: (r.respuesta && String(r.respuesta)) || 'Listo.',
        ejecutado: r.ejecutado === true,
      };
    } catch (e) {
      const status = this.statusDe(e);
      return { respuesta: this.mensajeAmable(status), ejecutado: false };
    }
  }

  /**
   * Transcribe una nota de voz vía la edge `transcribe-audio`. Best-effort: la
   * forma exacta del request/response es incierta, así que enviamos FormData con
   * el blob bajo `audio` y leemos defensivamente la transcripción de varias
   * claves posibles. NUNCA lanza: devuelve null si falla (el llamador cae a
   * escribir a mano).
   */
  async transcribir(blob: Blob): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'nota.webm');
      const { data, error } = await this.supabase.client.functions.invoke('transcribe-audio', {
        body: fd,
      });
      if (error) return null;
      const r = (data ?? {}) as Record<string, unknown>;
      for (const clave of ['text', 'transcripcion', 'transcript', 'respuesta']) {
        const v = r[clave];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Manejo de errores de edge (patrón de geocoding.service) ─────────────────

  /** Convierte un error de edge en una CompaRespuesta sintética (burbuja amable). */
  private async errorComoRespuesta(
    error: unknown,
    conversacionId: string | null,
  ): Promise<CompaRespuesta> {
    const body = await this.readEdgeError(error);
    const status = this.statusDe(error);
    return {
      conversacion_id: conversacionId,
      respuesta: this.mensajeAmable(status, body?.error),
      herramientas: [],
      propuesta: null,
    };
  }

  /**
   * Lee el body JSON de un error de edge function. Con supabase-js, en un status
   * !=2xx `error.context` es la Response de la edge → hay que clonarla y leer su
   * JSON (mismo patrón que GeocodingService.readEdgeError).
   */
  private async readEdgeError(error: unknown): Promise<{ error?: string } | null> {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      try {
        return await ctx.clone().json();
      } catch {
        /* body no-JSON */
      }
    }
    const legacy = (error as { context?: { error?: string }; message?: string })?.context?.error;
    return { error: legacy || (error as Error)?.message };
  }

  /** Extrae el status HTTP de un error de edge (Response en `context`). */
  private statusDe(error: unknown): number | null {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) return ctx.status;
    const s = (error as { context?: { status?: number }; status?: number })?.context?.status
      ?? (error as { status?: number })?.status;
    return typeof s === 'number' ? s : null;
  }

  /** Mensaje amable en español según el status (429/503/401) o el body de la edge. */
  private mensajeAmable(status: number | null, bodyError?: string): string {
    if (status === 429) {
      return 'Vas muy rápido 😅. Espera un momento e intenta de nuevo (máximo 60 mensajes por hora).';
    }
    if (status === 503) {
      // 503 = ANTHROPIC_API_KEY sin configurar: la edge manda el mensaje de
      // "no configurado" listo para mostrar → úsalo tal cual si viene.
      return (bodyError && bodyError.trim()) || 'Compa aún no está configurado. Avísale a Tecnología.';
    }
    if (status === 401) {
      return 'Tu sesión expiró. Vuelve a entrar para seguir usando a Compa.';
    }
    if (bodyError && bodyError.trim()) return bodyError.trim();
    return 'No pude conectar con Compa. Revisa tu internet e intenta de nuevo.';
  }
}
