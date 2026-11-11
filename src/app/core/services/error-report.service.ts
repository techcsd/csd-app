import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SyncService, throwSyncError, type PermanentSyncError } from '../sync/sync.service';
import type { OutboxOp } from '../db/app-db';
import { SupabaseService } from './supabase.service';
import { DeviceInfoService } from './device-info.service';
import { UpdateService } from './update.service';

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
  | 'login'
  // CA1 — evento informativo (no un error): p. ej. "alarma suprimida por preferencia"
  // desde el cliente, para contrastar con lo que el servidor mandó. Si el CHECK del
  // servidor aún no lo acepta, coacciona a 'other' (inofensivo); paridad owed en SGC.
  | 'info';

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

  /**
   * DB14 — familia de errores de "chunk perdido": el `index.html` cacheado pide un
   * JS que ya no existe en el servidor (se publicó una versión nueva) y el browser
   * recibe de vuelta el HTML de la SPA en vez del script, o directamente falla el
   * import dinámico. Sin manejo esto deja al usuario con una pantalla rota hasta que
   * recargue a mano — ya se vio 10+ veces en 6 dispositivos distintos.
   */
  private static readonly CHUNK_ERROR_PATTERNS = [
    /not a valid javascript mime type/i,
    /importing a module script failed/i,
    /failed to fetch dynamically imported module/i,
    // DH15 — "error loading dynamically imported module" (Firefox/variantes WebView)
    // es el MISMO chunk perdido con otra redacción; antes no disparaba autoRepair.
    /error loading dynamically imported module/i,
    /chunkloaderror/i,
    // DM-27 — `sw_update: instalación falló` es el mismo origen (service worker
    // desincronizado con el deploy actual); mismo auto-arreglo.
    /sw_update: instalaci[oó]n fall[oó]/i,
  ];

  /** DM-27 — localStorage, no sessionStorage: el auto-arreglo recarga la página (mata
   *  la pestaña, no la app), así que el conteo de intentos debe sobrevivir al reload. */
  private static readonly CHUNK_REPAIR_KEY = 'csd_chunk_repair_v1';
  private static readonly CHUNK_REPAIR_MAX_INTENTOS = 2;
  private static readonly CHUNK_REPAIR_VENTANA_MS = 10 * 60_000;

  /**
   * DM-24 — mensajes que son una REGLA DE NEGOCIO o un permiso denegado por el
   * usuario, no un fallo del sistema: no deben contarse como error (se guardan
   * como 'info', ya excluido de `listRecent`). Lista cerrada — ver CONTEXTO DM §2.2.
   */
  private static readonly REGLA_ESPERADA_PATTERNS = [
    /User denied Geolocation/i,
    /^\[conduce_/i,
    /existencia insuficiente/i,
    /no hay existencia/i,
    /fecha pasada/i,
    /permiso de registro retroactivo/i,
    /Failed to read the 'localStorage' property/i,
  ];

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
      // DH15 — un rechazo 'validacion' (P0001/22023: el RPC validó una REGLA DE
      // NEGOCIO — fecha retroactiva, estado de conduce, existencia insuficiente…)
      // no es un bug: el mensaje ya es accionable en español y el usuario lo ve en
      // la tarjeta del outbox. Reportarlo como 'sync' lo mezclaba con errores
      // técnicos reales en Reportes de errores (N15). `regla_negocio` sería el tipo
      // ideal, pero el CHECK del servidor (`report_app_error`) aún no lo acepta —
      // 'info' ya está desplegado para justo este caso (evento, no bug); migrar a
      // `regla_negocio` cuando el padre amplíe el CHECK es owed (DH23).
      const tipo = kind === 'validacion' ? 'info' : 'sync';
      void this.report(tipo, `[${op.tipo_op}] ${msg}`, {
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
    const mensaje = this.messageOf(error);

    // DB14/DM-27 — chunk perdido tras un deploy nuevo: auto-reparar (desregistra el
    // SW + limpia cachés + recarga) en vez de dejar al usuario con una pantalla rota.
    if (ErrorReportService.CHUNK_ERROR_PATTERNS.some((p) => p.test(mensaje))) {
      this.handleChunkError(mensaje, this.stackOf(error));
      return;
    }

    void this.report('crash', mensaje, {}, this.stackOf(error));
  }

  /**
   * DM-27 — el 1er intento de auto-arreglo NO cuenta como error (se registra como
   * 'info' "auto-reparado"): si el reload resuelve el chunk perdido, el usuario
   * nunca lo nota y no hay nada que investigar. Solo si el MISMO tipo de falla
   * reaparece dentro de la ventana (el auto-arreglo no lo resolvió) se reporta
   * como 'crash' real y se deja de reintentar (evita un bucle de recargas).
   */
  private handleChunkError(mensaje: string, stack: string | null): void {
    let intentos = 0;
    let at = 0;
    try {
      const raw = localStorage.getItem(ErrorReportService.CHUNK_REPAIR_KEY);
      if (raw) ({ intentos, at } = JSON.parse(raw) as { intentos: number; at: number });
      if (Date.now() - at > ErrorReportService.CHUNK_REPAIR_VENTANA_MS) intentos = 0;
    } catch {
      intentos = 0;
    }

    if (intentos >= ErrorReportService.CHUNK_REPAIR_MAX_INTENTOS) {
      // Ya se intentó reparar y el problema persiste: esto sí es un fallo real.
      try {
        localStorage.removeItem(ErrorReportService.CHUNK_REPAIR_KEY);
      } catch {
        /* best-effort */
      }
      void this.report('crash', mensaje, { auto_reparado_intentos: intentos }, stack);
      return;
    }

    try {
      localStorage.setItem(
        ErrorReportService.CHUNK_REPAIR_KEY,
        JSON.stringify({ intentos: intentos + 1, at: Date.now() }),
      );
    } catch {
      /* best-effort */
    }
    void this.report('info', `auto-reparado: ${mensaje}`, { auto_reparado_intento: intentos + 1 }, stack);
    // Lazy injector (no un campo inyectado) a propósito: UpdateService ya inyecta
    // ErrorReportService, así que un campo aquí sería un ciclo de DI.
    try {
      void this.injector.get(UpdateService).autoRepair('chunk_perdido');
    } catch {
      /* best-effort */
    }
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

    // DM-24 — reclasifica a 'info' (no cuenta como error) lo que ya es una regla de
    // negocio esperada o un permiso que el usuario negó, sea cual sea el tipo con
    // que se llamó a report(). Lista cerrada, ver CONTEXTO DM §2.2.
    const tipoFinal: AppErrorType = ErrorReportService.REGLA_ESPERADA_PATTERNS.some((p) => p.test(cleanMsg))
      ? 'info'
      : errorType;

    this.reentrant = true;
    try {
      const d = await this.device.ready();
      const id = crypto.randomUUID();
      const payload = {
        id,
        error_type: String(tipoFinal).slice(0, 40),
        message: cleanMsg.slice(0, 2000) || '(sin mensaje)',
        stack: stack ? this.sanitize(stack).slice(0, 8000) : null,
        // BT5 — adjunta el estado de memoria del dispositivo/pestaña. Un cierre por
        // presión de memoria (Safari mata la pestaña, Android recrea la Activity) se
        // reconoce por `mem_used_mb` alto / `device_mem_gb` bajo justo antes del crash.
        // BU1 F1.3 — etiqueta el entorno en el context (dev/prod ya escriben a BDs
        // distintas, pero esto lo deja explícito en la fila sin tocar el RPC).
        context: { entorno: environment.entorno, route: this.currentRoute(), ...this.memoryInfo(), ...this.sanitizeContext(context) },
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
   * DH15 — excluye 'info' (rechazos de regla de negocio, ya accionables para el
   * usuario en su outbox): no son bugs que Tecnología deba atender, y mezclados
   * con los reales era justo el ruido que N15 pidió limpiar.
   */
  async listRecent(limit = 100): Promise<AppErrorReportRow[]> {
    const { data, error } = await this.supabase.client
      .from('app_error_reports')
      .select('id, error_type, message, device_model, device_brand, os_version, app_version, platform, context, created_at')
      .neq('error_type', 'info')
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

  /**
   * BT5 — instantánea de memoria (best-effort). `performance.memory` es no estándar
   * (Chromium/Android WebView); `navigator.deviceMemory` da GB de RAM aproximados.
   * En Safari/iOS ninguno existe → se omiten. Solo números, nunca datos sensibles.
   */
  private memoryInfo(): Record<string, number> {
    const out: Record<string, number> = {};
    try {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } })?.memory;
      if (mem?.usedJSHeapSize) out['mem_used_mb'] = Math.round(mem.usedJSHeapSize / 1048576);
      if (mem?.jsHeapSizeLimit) out['mem_limit_mb'] = Math.round(mem.jsHeapSizeLimit / 1048576);
      const dm = (navigator as unknown as { deviceMemory?: number })?.deviceMemory;
      if (dm) out['device_mem_gb'] = dm;
    } catch {
      /* ignore */
    }
    return out;
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
