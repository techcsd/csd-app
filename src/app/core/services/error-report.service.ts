import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SyncService, throwSyncError, type PermanentSyncError } from '../sync/sync.service';
import type { OutboxOp } from '../db/app-db';
import { SupabaseService } from './supabase.service';
import { DeviceInfoService } from './device-info.service';

/**
 * Y6 — tipos de error que instrumentamos. `crash`/`error` son automáticos
 * (ErrorHandler + listeners de window); el resto son puntos críticos con
 * `report(...)` explícito (cámara, GPS, voz, sync, permisos, tracking, login).
 *
 * BI4 — unión CERRADA a propósito (antes terminaba en `(string & {})`, que aceptaba
 * cualquier cadena y por eso `tracking`/`login` no estaban declarados y el servidor
 * los coaccionaba a `other`). El CHECK del servidor se amplía en PROMPT-32 F6.1 para
 * aceptar estos mismos tipos; mantener ambas listas alineadas. Cerrarla hace que un
 * tipo nuevo NO compile hasta añadirlo aquí (y, por regla de paridad, en el CHECK).
 */
export type AppErrorType =
  | 'crash'
  | 'error'
  | 'camera'
  | 'gps'
  | 'voice'
  | 'sync'
  | 'permission'
  | 'tracking'
  | 'login';

/** Y11 — una fila de la vista compacta de reportes (Tecnología). */
export interface AppErrorReportRow {
  id: string;
  error_type: string;
  message: string;
  device_model: string | null;
  device_brand: string | null;
  os_version: string | null;
  app_version: string | null;
  platform: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Y6 — Telemetría de errores propia (sin servicios externos). Actúa como el
 * `ErrorHandler` global de Angular (que ya recibe `window.onerror` y
 * `unhandledrejection` vía `provideBrowserGlobalErrorListeners`) y expone una
 * API `report()` para instrumentar puntos críticos. Los reportes se envían por
 * el **outbox** (op `error_report` → RPC `sgc.report_app_error`), así que si no
 * hay señal se mandan al reconectar. Sanitiza (nunca datos sensibles ni bytes de
 * fotos), evita bucles (los fallos del propio envío no generan más reportes) y
 * limita el volumen (máx N reportes/hora, el resto se descarta en silencio).
 */
@Injectable({ providedIn: 'root' })
export class ErrorReportService implements ErrorHandler {
  private injector = inject(Injector);
  private device = inject(DeviceInfoService);
  private supabase = inject(SupabaseService);

  /** Anti-bucle: un fallo dentro del propio reporte no debe generar otro. */
  private reentrant = false;
  /** Ventana deslizante de timestamps de reportes emitidos (rate-limit). */
  private emitted: number[] = [];
  private static readonly MAX_PER_HOUR = 30;
  private static readonly WINDOW_MS = 3_600_000;

  constructor() {
    // El handler del outbox: envía el reporte al RPC. Es retrocompatible con la
    // clasificación de errores del SyncService (permanente vs transitorio).
    const sync = this.injector.get(SyncService);
    sync.register('error_report', async (payload) => {
      const { error } = await this.supabase.client.rpc('report_app_error', {
        p_error_type: payload['error_type'],
        p_message: payload['message'],
        p_stack: payload['stack'] ?? null,
        p_context: payload['context'] ?? {},
        p_device_model: payload['device_model'] ?? null,
        p_device_brand: payload['device_brand'] ?? null,
        p_os_version: payload['os_version'] ?? null,
        p_app_version: payload['app_version'] ?? null,
        p_platform: payload['platform'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // Y6 — reportar los fallos PERMANENTES del propio outbox (un RPC que rechaza,
    // permiso/RLS, foto perdida…), sin caer en bucle con el propio 'error_report'.
    sync.onPermanentError = (op: OutboxOp, err: unknown) => {
      if (op.tipo_op === 'error_report') return; // anti-bucle
      const kind = (err as PermanentSyncError | undefined)?.kind;
      const msg = err instanceof Error ? err.message : String(err);
      void this.report('sync', `[${op.tipo_op}] ${msg}`, {
        tipo_op: op.tipo_op,
        error_kind: kind ?? null,
        op_id: op.id,
        intentos: op.intentos,
      });
    };
  }

  // ─── ErrorHandler global (crashes / errores no capturados) ───────────────
  handleError(error: unknown): void {
    // Mantener el log de consola (reemplazamos el ErrorHandler por defecto).
    console.error(error);
    void this.report('crash', this.messageOf(error), {}, this.stackOf(error));
  }

  /**
   * API explícita para instrumentar puntos críticos. `context` se sanitiza y se
   * fusiona con la ruta actual. Nunca lanza (best-effort).
   */
  async report(
    errorType: AppErrorType,
    message: string,
    context: Record<string, unknown> = {},
    stack?: string | null,
  ): Promise<void> {
    if (this.reentrant) return;
    const cleanMsg = this.sanitize(message);
    // Anti-bucle: nunca reportar fallos de nuestra propia maquinaria de reporte.
    if (this.isSelfError(cleanMsg, stack)) return;
    if (!this.allowByRate()) return;

    this.reentrant = true;
    try {
      const d = await this.device.ready();
      const id = crypto.randomUUID();
      const payload = {
        id,
        error_type: String(errorType).slice(0, 40),
        message: cleanMsg.slice(0, 2000) || '(sin mensaje)',
        stack: stack ? this.sanitize(stack).slice(0, 8000) : null,
        context: { route: this.currentRoute(), ...this.sanitizeContext(context) },
        device_model: d.model,
        device_brand: d.manufacturer,
        os_version: d.osVersion,
        app_version: environment.version,
        platform: d.platform,
      };
      const sync = this.injector.get(SyncService);
      await sync.enqueue({ id, tipo_op: 'error_report', payload });
    } catch {
      /* el reporte jamás debe tumbar la app ni generar otro reporte */
    } finally {
      this.reentrant = false;
    }
  }

  /**
   * Y11 — vista compacta de reportes para la sección Tecnología. La RLS
   * (`es_tecnologia()`) ya scopea: solo admin/tecnología leen. Online.
   */
  async listRecent(limit = 100): Promise<AppErrorReportRow[]> {
    const { data, error } = await this.supabase.client
      .from('app_error_reports')
      .select('id, error_type, message, device_model, device_brand, os_version, app_version, platform, context, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data as unknown as AppErrorReportRow[]) ?? [];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private allowByRate(): boolean {
    const now = Date.now();
    this.emitted = this.emitted.filter((t) => now - t < ErrorReportService.WINDOW_MS);
    if (this.emitted.length >= ErrorReportService.MAX_PER_HOUR) return false;
    this.emitted.push(now);
    return true;
  }

  private currentRoute(): string {
    try {
      return this.injector.get(Router).url || location?.hash || '';
    } catch {
      return '';
    }
  }

  private messageOf(error: unknown): string {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === 'string') return error;
    try {
      const rej = (error as { rejection?: unknown })?.rejection;
      if (rej) return this.messageOf(rej);
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private stackOf(error: unknown): string | null {
    if (error instanceof Error && error.stack) return error.stack;
    const rej = (error as { rejection?: unknown })?.rejection;
    if (rej instanceof Error && rej.stack) return rej.stack;
    return null;
  }

  private isSelfError(message: string, stack?: string | null): boolean {
    const hay = `${message} ${stack ?? ''}`.toLowerCase();
    return hay.includes('error-report.service') || hay.includes('report_app_error');
  }

  /** Quita bytes de imagen, tokens y credenciales de cualquier texto. */
  private sanitize(text: string): string {
    if (!text) return '';
    return text
      .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, '[data-uri]')
      .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi, '[jwt]')
      .replace(/(access[_-]?token|apikey|api[_-]?key|password|secret|authorization)["'\s:=]+[^\s"',}]+/gi, '$1=[redacted]');
  }

  /** Solo valores primitivos/cortos; descarta Blob/ArrayBuffer/objetos grandes. */
  private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(context ?? {})) {
      if (v == null) {
        out[k] = null;
      } else if (typeof v === 'string') {
        out[k] = this.sanitize(v).slice(0, 500);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v;
      }
      // Se ignoran a propósito objetos/Blob/arrays: nada de bytes ni payloads.
    }
    return out;
  }
}
