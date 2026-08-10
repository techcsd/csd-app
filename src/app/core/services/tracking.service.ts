import { effect, inject, Injectable, signal } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

// AF27 — el plugin no exporta un valor; se registra por nombre (nativo). En web es
// un proxy que lanza "not implemented" → por eso solo se usa tras isNativePlatform().
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
import { SupabaseService } from './supabase.service';
import { PermissionsService } from './permissions.service';
import { LocalStore } from './local-store.service';
import { NetworkService } from './network.service';
import { ToastService } from './toast.service';
import { ErrorReportService } from './error-report.service';

interface PosBuffer {
  lat: number;
  lng: number;
  precision: number | null;
  bateria: number | null;
  capturado_en: string;
  vehiculo_id: string | null;
  /** AJ14 — ruta activa que originó el punto (para consolidar el trayecto). */
  ruta_id: string | null;
}

const BUFFER_KEY = 'tracking_buffer';
const FLUSH_MS = 45_000; // AF27 — lote cada ~45 s en ruta activa
const MAX_BUFFER = 12; // fuerza flush al llegar a este tamaño
const MAX_PERSIST = 2000; // QA-35 — tope del buffer en disco (rutas largas offline)
const WATCHDOG_MS = 60_000; // AG11 — el watchdog revisa cada minuto
const STALE_FIX_MS = 5 * 60_000; // AG11 — sin fix en 5 min con ruta activa = re-armar

/**
 * AF26/AF27 — ubicación siempre activa + tracking en primer plano.
 *
 * - **Gate por GPS (AF26):** `exigirGps()` bloquea crear/iniciar ruta, crear conduce
 *   y marcar entregas si el GPS está apagado o el permiso revocado, con banner
 *   persistente (`gpsBloqueado`) + telemetría (`registrar_gps_evento`, Y6).
 * - **Tracking (AF27):** durante una ruta activa reporta la posición en PRIMER
 *   PLANO (`watchPosition`), en lotes a `registrar_posiciones` (offline-first: si no
 *   hay señal se acumula en disco y se reintenta al volver).
 *
 * **Foreground service (Android):** usa `@capacitor-community/background-geolocation`
 * — un servicio en primer plano con notificación persistente que sigue reportando
 * la posición aunque la app pase a segundo plano durante una ruta. En web/PWA cae
 * a `watchPosition` (solo con la pestaña activa). ⚠️ device-QA del background real
 * requiere un APK instalado.
 */
@Injectable({ providedIn: 'root' })
export class TrackingService {
  private supabase = inject(SupabaseService);
  private permissions = inject(PermissionsService);
  private store = inject(LocalStore);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private errors = inject(ErrorReportService);

  /** true = GPS apagado o permiso revocado → funciones de transporte bloqueadas. */
  gpsBloqueado = signal(false);
  /** 'permiso' | 'apagado' | '' — para el mensaje del banner. */
  gpsMotivo = signal<'permiso' | 'apagado' | ''>('');
  rastreando = signal(false);
  /** AG11 — epoch ms del último fix capturado (para el watchdog / indicador). */
  ultimoFix = signal<number | null>(null);

  private buffer: PosBuffer[] = [];
  private watchId: string | null = null; // @capacitor/geolocation (web)
  private bgWatcherId: string | null = null; // background-geolocation (nativo)
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private vehiculoActual: string | null = null;
  private rutaActual: string | null = null; // AJ14 — ruta activa a taggear en cada punto
  private ultimaFlushOk = Date.now();
  /** true mientras un re-arranque del watchdog está en curso (evita solaparlos). */
  private rearmando = false;
  /** QA-10 — true mientras un flush está en vuelo (evita solapar dos envíos). */
  private flushing = false;
  /** QA-10 — se pidió un flush mientras había uno en vuelo → re-ejecutar al terminar. */
  private flushAgain = false;

  constructor() {
    void this.restaurarBuffer();
    // Al recuperar señal, intenta drenar las posiciones acumuladas.
    effect(() => {
      if (this.net.online()) void this.flush();
    });
  }

  // ── AF26 — gate por GPS ─────────────────────────────────────────────────────

  /**
   * Revisa el estado del GPS/permiso y actualiza el banner. Devuelve true si el GPS
   * está OK. Registra el evento (apagado/reactivado/permiso revocado) en telemetría.
   */
  async revisarGps(): Promise<boolean> {
    const estabaBloqueado = this.gpsBloqueado();
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 12000 });
    if (r.ok) {
      if (estabaBloqueado) {
        this.gpsBloqueado.set(false);
        this.gpsMotivo.set('');
        void this.logEvento('gps_reactivado');
      }
      return true;
    }
    // Bloqueado: distinguir permiso vs GPS del sistema apagado.
    const motivo = r.reason === 'denied' || r.reason === 'denied-permanent' ? 'permiso' : 'apagado';
    this.gpsBloqueado.set(true);
    this.gpsMotivo.set(motivo);
    if (!estabaBloqueado) {
      void this.logEvento(motivo === 'permiso' ? 'permiso_revocado' : 'gps_apagado', r.reason);
    }
    return false;
  }

  /**
   * AF26 — exige GPS para una acción de transporte (crear/iniciar ruta, crear
   * conduce, marcar entrega). Si está bloqueado: avisa (con acción "Abrir ajustes"),
   * registra que se intentó operar sin GPS y devuelve false.
   */
  async exigirGps(accion: string): Promise<boolean> {
    if (await this.revisarGps()) return true;
    void this.logEvento('operando_sin_gps', accion);
    const msg =
      this.gpsMotivo() === 'permiso'
        ? 'Activa el permiso de ubicación para continuar. La empresa necesita saber dónde estás durante el trabajo.'
        : 'Enciende la ubicación (GPS) del teléfono para continuar.';
    this.toast.withAction(
      msg,
      { label: 'Abrir ajustes', run: () => void this.permissions.openAppSettings() },
      'error',
      9000,
    );
    return false;
  }

  private async logEvento(
    tipo: 'gps_apagado' | 'gps_reactivado' | 'permiso_revocado' | 'operando_sin_gps',
    detalle?: string,
  ): Promise<void> {
    if (!this.net.online()) return;
    try {
      await this.supabase.client.rpc('registrar_gps_evento', { p_tipo: tipo, p_detalle: detalle ?? null });
    } catch {
      /* best-effort */
    }
  }

  // ── AF27 — tracking en primer plano ─────────────────────────────────────────

  /** Arranca el reporte de posición (mientras haya una ruta activa). En nativo usa
   *  el foreground service (sigue en segundo plano); en web, watchPosition. */
  async iniciarTracking(vehiculoId?: string | null, rutaId?: string | null): Promise<void> {
    this.vehiculoActual = vehiculoId ?? null;
    // AJ14 — conserva la ruta previa cuando el re-armado del watchdog no la reenvía.
    if (rutaId !== undefined) this.rutaActual = rutaId;
    if (this.rastreando()) return;
    try {
      if (Capacitor.isNativePlatform()) {
        // Foreground service con notificación persistente (Android).
        this.bgWatcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: 'Reportando tu ubicación durante la ruta.',
            backgroundTitle: 'CSD App — ruta activa',
            requestPermissions: true,
            stale: false,
            distanceFilter: 40,
          },
          (location, error) => {
            if (error) {
              // AG15 — el error del watcher nativo (permiso "always" no concedido,
              // servicio detenido por el SO) ya no se traga: a Y6 (rate-limited).
              this.errors.report('tracking', 'watcher nativo devolvió error', {
                code: (error as { code?: string }).code ?? null,
                message: (error as { message?: string }).message ?? String(error),
              });
              return;
            }
            if (!location) return;
            void this.push(location.latitude, location.longitude, location.accuracy ?? null);
          },
        );
      } else {
        // PWA/iOS: la Permissions API reporta 'prompt' PARA SIEMPRE en Safari
        // aunque el usuario ya haya concedido (cf. iOS PWA Permissions gotcha), así
        // que exigir === 'granted' impedía arrancar el watch en iPhone. Solo
        // abortamos si está EXPLÍCITAMENTE denegado; en cualquier otro caso dejamos
        // que watchPosition dispare/valide el permiso.
        const st = await this.permissions.checkLocation();
        if (st === 'denied') {
          this.errors.report('tracking', 'watch no arrancó: permiso de ubicación denegado (web)', { st });
          return;
        }
        if (!('geolocation' in navigator)) return;
        this.watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 },
          (pos, err) => {
            if (err || !pos) return;
            void this.push(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
          },
        );
      }
      this.rastreando.set(true);
      this.ultimaFlushOk = Date.now();
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
      this.iniciarWatchdog();
      void this.avisarBateriaUnaVez(); // AK13 — exclusión de optimización de batería (MIUI)
    } catch (e) {
      // AG11 — antes fallaba en silencio ("el tracking simplemente no arranca").
      // Ahora lo reportamos a Y6 para no tener un punto ciego en el arranque.
      this.errors.report('tracking', 'iniciarTracking falló', {
        native: Capacitor.isNativePlatform(),
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * AK13 — MIUI/OEM agresivos matan el foreground service en background, así que el
   * trayecto se pierde. Una sola vez (por instalación) avisamos al chofer que debe
   * excluir la app de la optimización de batería + fijarla en recientes. El prompt
   * nativo real (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) requiere un plugin
   * nativo; hasta tenerlo, guiamos con instrucciones claras (config manual).
   */
  private async avisarBateriaUnaVez(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const KEY = 'tracking_bateria_avisado';
    try {
      if (await this.store.get(KEY)) return;
      await this.store.set(KEY, '1');
    } catch {
      /* si el store falla, mostramos el aviso igual (sin persistir) */
    }
    this.toast.show(
      'Para que la ruta se rastree con la pantalla apagada: Ajustes → Batería → CSD App → "Sin restricciones", y fija la app en recientes.',
      'info',
      9000,
    );
  }

  /**
   * AG11 — reanuda el tracking si hay una ruta activa y no está corriendo (p. ej.
   * la app se reabrió a mitad de ruta o el SO mató el proceso). Idempotente.
   */
  resumirSiRutaActiva(vehiculoId?: string | null, rutaId?: string | null): void {
    if (this.rastreando()) {
      // Ya corre: solo refresca el vehículo/ruta si llegó uno mejor.
      if (vehiculoId && !this.vehiculoActual) this.vehiculoActual = vehiculoId;
      if (rutaId && !this.rutaActual) this.rutaActual = rutaId;
      return;
    }
    void this.iniciarTracking(vehiculoId ?? null, rutaId ?? null);
  }

  /** Detiene el tracking (al completar/cancelar la ruta) y drena lo pendiente. */
  async detenerTracking(): Promise<void> {
    if (this.bgWatcherId != null) {
      try {
        await BackgroundGeolocation.removeWatcher({ id: this.bgWatcherId });
      } catch {
        /* ignore */
      }
      this.bgWatcherId = null;
    }
    if (this.watchId != null) {
      try {
        await Geolocation.clearWatch({ id: this.watchId });
      } catch {
        /* ignore */
      }
      this.watchId = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.rastreando.set(false);
    this.rutaActual = null; // AJ14 — la ruta terminó
    await this.flush();
  }

  private async push(lat: number, lng: number, precision: number | null): Promise<void> {
    this.buffer.push({
      lat,
      lng,
      precision,
      bateria: await this.bateria(),
      capturado_en: new Date().toISOString(),
      vehiculo_id: this.vehiculoActual,
      ruta_id: this.rutaActual,
    });
    this.ultimoFix.set(Date.now());
    await this.persistBuffer();
    if (this.buffer.length >= MAX_BUFFER) void this.flush();
  }

  /** Envía el lote acumulado a `registrar_posiciones` (offline-first: reintenta luego). */
  private async flush(): Promise<void> {
    if (!this.buffer.length || !this.net.online()) return;
    // QA-10: un solo flush a la vez. Si llega otro disparo (timer/online/MAX_BUFFER)
    // mientras hay uno en vuelo, se marca para re-ejecutar al terminar (coalescing)
    // en lugar de solaparse — dos runs reenviaban el mismo lote y ambos recortaban
    // el buffer, duplicando o perdiendo puntos.
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      const lote = this.buffer.slice();
      const { error } = await this.supabase.client.rpc('registrar_posiciones', {
        p_posiciones: lote.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          precision: p.precision,
          bateria: p.bateria,
          capturado_en: p.capturado_en,
          vehiculo_id: p.vehiculo_id,
          ruta_id: p.ruta_id ?? null,
        })),
      });
      if (error) {
        // AG11 — el rechazo del RPC (RLS/permiso/param) ya NO se traga en silencio:
        // era el punto ciego que dejaba "sin ubicación" sin rastro en telemetría.
        this.errors.report('tracking', 'registrar_posiciones rechazó el lote', {
          code: error.code,
          message: error.message,
          lote: lote.length,
        });
        return; // conserva el buffer para reintentar
      }
      // QA-10: quita EXACTAMENTE los objetos enviados (por identidad), no por
      // longitud — así un push() concurrente durante el await no causa drift.
      const enviados = new Set(lote);
      this.buffer = this.buffer.filter((p) => !enviados.has(p));
      this.ultimaFlushOk = Date.now();
      await this.persistBuffer();
    } catch {
      /* sin señal / error de red → se reintenta (no es un fallo reportable) */
    } finally {
      this.flushing = false;
      // QA-10: hubo un disparo durante el envío → drena lo que quedó en el buffer.
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    }
  }

  /**
   * AG11 — watchdog: cada minuto verifica que, estando "en ruta", el tracking siga
   * entregando fixes. Si lleva demasiado sin un fix nuevo (watcher muerto por el SO,
   * permiso revocado en caliente, etc.), lo reporta a Y6 y RE-ARRANCA el watcher.
   */
  private iniciarWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => void this.watchdogTick(), WATCHDOG_MS);
  }

  private async watchdogTick(): Promise<void> {
    if (!this.rastreando() || this.rearmando) return;
    const last = this.ultimoFix();
    const sinFixMs = last == null ? Date.now() - this.ultimaFlushOk : Date.now() - last;
    if (sinFixMs < STALE_FIX_MS) return;
    // El tracking DEBERÍA estar reportando y no lo está → reportar y re-armar.
    this.rearmando = true;
    this.errors.report('tracking', 'watchdog: sin fixes recientes, re-armando watcher', {
      sin_fix_ms: sinFixMs,
      buffer: this.buffer.length,
      native: Capacitor.isNativePlatform(),
    });
    try {
      const veh = this.vehiculoActual;
      await this.pararWatchers();
      this.rastreando.set(false);
      await this.iniciarTracking(veh);
    } finally {
      this.rearmando = false;
    }
  }

  /** Detiene solo los watchers (sin tocar timers) — usado por el re-armado. */
  private async pararWatchers(): Promise<void> {
    if (this.bgWatcherId != null) {
      try {
        await BackgroundGeolocation.removeWatcher({ id: this.bgWatcherId });
      } catch {
        /* ignore */
      }
      this.bgWatcherId = null;
    }
    if (this.watchId != null) {
      try {
        await Geolocation.clearWatch({ id: this.watchId });
      } catch {
        /* ignore */
      }
      this.watchId = null;
    }
  }

  private async bateria(): Promise<number | null> {
    try {
      const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
      if (nav.getBattery) {
        const b = await nav.getBattery();
        return Math.round(b.level * 100);
      }
    } catch {
      /* no disponible */
    }
    return null;
  }

  private async persistBuffer(): Promise<void> {
    try {
      // QA-35: tope alto (2000) para no perder los fixes más antiguos en rutas
      // largas sin señal; aún así acotado y con aviso al truncar.
      let toSave = this.buffer;
      if (toSave.length > MAX_PERSIST) {
        console.warn(
          `[tracking] buffer excede ${MAX_PERSIST} puntos (${toSave.length}); se descartan los más antiguos.`,
        );
        toSave = toSave.slice(-MAX_PERSIST);
      }
      await this.store.set(BUFFER_KEY, JSON.stringify(toSave));
    } catch {
      /* ignore */
    }
  }

  private async restaurarBuffer(): Promise<void> {
    const raw = await this.store.get(BUFFER_KEY);
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.buffer = arr as PosBuffer[];
    } catch {
      /* ignore */
    }
  }
}
