import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompaRespuesta, Propuesta } from '../models/compa.model';

/**
 * AZ5 — Resultado de una transcripción de voz, con la CAUSA cuando falla, para
 * que el UI muestre un mensaje específico (no un genérico "no pudimos transcribir"):
 *  - vacio          → no se entendió nada (intenta de nuevo o escribe)
 *  - no_configurado → el proyecto no tiene STT configurado (tema de Tecnología)
 *  - sin_conexion   → se perdió la conexión al transcribir
 *  - servicio       → el servicio de voz falló (red/proveedor)
 */
export type TranscripcionResultado =
  | { ok: true; texto: string }
  | { ok: false; causa: 'vacio' | 'no_configurado' | 'sin_conexion' | 'servicio' };

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
   * AZ5 — Transcribe una nota de voz SÍNCRONA vía la edge `transcribe-now`
   * (recibe el blob y devuelve `{ text }` en el mismo turno). Distinta de
   * `transcribe-audio` (barrido por pg_cron, protegido con x-sync-secret — jamás
   * usable así desde el cliente: ese era el bug del banner "No pudimos transcribir").
   *
   * NUNCA lanza: devuelve un {@link TranscripcionResultado} con la CAUSA cuando
   * falla, para que el UI muestre el mensaje correcto (config vs conexión vs
   * "no se entendió"). El texto transcrito lo edita el usuario antes de enviar.
   */
  async transcribir(blob: Blob): Promise<TranscripcionResultado> {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'nota.webm');
      const { data, error } = await this.supabase.client.functions.invoke('transcribe-now', {
        body: fd,
      });
      if (error) {
        const status = this.statusDe(error);
        const body = await this.readEdgeError(error);
        // 503 = STT sin configurar en el proyecto (avísale a Tecnología).
        if (status === 503 || body?.error === 'stt_not_configured') {
          return { ok: false, causa: 'no_configurado' };
        }
        // Sin status/context = fallo de red (functions.invoke no llegó a la edge).
        if (status == null) return { ok: false, causa: 'sin_conexion' };
        return { ok: false, causa: 'servicio' };
      }
      const r = (data ?? {}) as Record<string, unknown>;
      const texto = typeof r['text'] === 'string' ? (r['text'] as string).trim() : '';
      if (texto) return { ok: true, texto };
      // 200 con texto vacío = no se entendió (ruido de obra, audio muy corto…).
      return { ok: false, causa: 'vacio' };
    } catch {
      // Excepción inesperada (sin Response) = tratamos como fallo de red.
      return { ok: false, causa: 'sin_conexion' };
    }
  }

  /**
   * BA3 — chips + saludo/subtítulo de Compa POR ROL (fuente única web+app+edge:
   * RPC `compa_sugerencias`, que resuelve la persona del usuario del JWT). Best-effort:
   * devuelve null si falla y el llamador cae a sus valores por defecto.
   */
  async sugerencias(): Promise<{ chips: string[]; saludo: string; subtitulo: string } | null> {
    try {
      const { data, error } = await this.supabase.client.rpc('compa_sugerencias');
      if (error || !Array.isArray(data) || data.length === 0) return null;
      const rows = data as { texto: string; saludo: string | null; subtitulo: string | null }[];
      const chips = rows.map((r) => r.texto).filter((t): t is string => !!t && !!t.trim());
      if (!chips.length) return null;
      return {
        chips,
        saludo: rows[0]?.saludo?.trim() || '',
        subtitulo: rows[0]?.subtitulo?.trim() || '',
      };
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
