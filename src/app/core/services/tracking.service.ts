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
import { db, PosicionBuffer } from '../db/app-db';

const LEGACY_BUFFER_KEY = 'tracking_buffer'; // AU7 — buffer viejo en LocalStore (se migra a Dexie)
const FLUSH_MS = 45_000; // AF27 — lote cada ~45 s en ruta activa
const MAX_BUFFER = 12; // fuerza flush al llegar a este tamaño
const FLUSH_BATCH = 300; // AU7 — puntos por lote de subida (rutas largas offline)
const BUFFER_MAX_DAYS = 7; // AU7 — se purgan los puntos locales de más de 7 días
const WATCHDOG_MS = 60_000; // AG11 — el watchdog revisa cada minuto
const STALE_FIX_MS = 5 * 60_000; // AG11 — sin fix en 5 min con ruta activa = re-armar
// AS1 — latido de frescura: aunque el chofer esté parado (el watcher con
// distanceFilter no dispara sin movimiento), forzamos un fix cada ~2.5 min para
// que "hace X" y el mapa no se vean congelados (estilo Uber: "actualizado hace Xs").
// También sirve de segunda vía de captura si el watcher nativo se estanca.
const HEARTBEAT_MS = 150_000;
const DEFAULT_DISTANCE_FILTER = 25; // m — override por mi_config_tracking()

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
  /** AU7 — puntos GPS locales aún sin subir ("N puntos por sincronizar"). */
  private _pendientesSync = signal(0);
  pendientesSync = this._pendientesSync.asReadonly();
  private watchId: string | null = null; // @capacitor/geolocation (web)
  private bgWatcherId: string | null = null; // background-geolocation (nativo)
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null; // AS1
  private vehiculoActual: string | null = null;
  private rutaActual: string | null = null; // AJ14 — ruta activa a taggear en cada punto
  private ultimaFlushOk = Date.now();
  private ultimaCoord: { lat: number; lng: number; precision: number | null } | null = null; // AS1
  /** AS1 — true cuando el usuario comparte ubicación → el tracking corre en
   *  CONTINUO (todo el turno), no solo durante una ruta formal. Es la raíz del
   *  "dura días para actualizar": antes solo se capturaba dentro de una ruta. */
  private modoContinuo = false;
  /** AS1 — distanceFilter efectivo (m), configurable desde mi_config_tracking(). */
  private distanceFilter = DEFAULT_DISTANCE_FILTER;
  /** AS1 — periodo de flush efectivo (ms), configurable desde el servidor. */
  private flushMs = FLUSH_MS;
  /** AS1 — evita evaluar el modo continuo dos veces en paralelo. */
  private evaluando = false;
  /** true mientras un re-arranque del watchdog está en curso (evita solaparlos). */
  private rearmando = false;
  /** QA-10 — true mientras un flush está en vuelo (evita solapar dos envíos). */
  private flushing = false;
  /** QA-10 — se pidió un flush mientras había uno en vuelo → re-ejecutar al terminar. */
  private flushAgain = false;

  constructor() {
    void this.bootBuffer();
    // Al recuperar señal, intenta drenar las posiciones acumuladas.
    effect(() => {
      if (this.net.online()) void this.flush();
    });
  }

  /**
   * AU7 — arranque del buffer offline (Dexie): migra el buffer viejo de LocalStore
   * (si quedó de una versión anterior), purga los puntos de más de 7 días y publica
   * el conteo "por sincronizar". Best-effort: nunca rompe el arranque de la app.
   */
  private async bootBuffer(): Promise<void> {
    try {
      await this.migrarBufferLegacy();
      await this.purgarViejos();
      await this.refrescarPendientes();
    } catch {
      /* best-effort */
    }
  }

  /** AU7 — trae a Dexie el buffer que versiones previas guardaban en LocalStore. */
  private async migrarBufferLegacy(): Promise<void> {
    const raw = await this.store.get(LEGACY_BUFFER_KEY);
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        await db.posiciones.bulkAdd(
          (arr as PosicionBuffer[]).map((p) => ({
            lat: p.lat, lng: p.lng, precision: p.precision ?? null, bateria: p.bateria ?? null,
            capturado_en: p.capturado_en, vehiculo_id: p.vehiculo_id ?? null, ruta_id: p.ruta_id ?? null,
          })),
        );
      }
    } catch {
      /* dato corrupto: se descarta */
    }
    await this.store.remove(LEGACY_BUFFER_KEY);
  }

  /** AU7 — descarta puntos locales de más de BUFFER_MAX_DAYS (ISO ordena lexicográfico). */
  private async purgarViejos(): Promise<void> {
    const corte = new Date(Date.now() - BUFFER_MAX_DAYS * 86_400_000).toISOString();
    await db.posiciones.where('capturado_en').below(corte).delete();
  }

  private async refrescarPendientes(): Promise<void> {
    try {
      this._pendientesSync.set(await db.posiciones.count());
    } catch {
      /* ignore */
    }
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

  // ── AS1 — tracking continuo (todo el turno) ─────────────────────────────────

  /**
   * AS1 — decide si este usuario debe rastrear en CONTINUO y, de ser así, lo
   * arranca. Se llama al bootear la app y al volver a primer plano. Antes el
   * tracking solo corría dentro de una "ruta activa" formal → si el chofer no
   * creaba una ruta en la app, no reportaba NADA (raíz del "dura días para
   * actualizar", confirmado en `gps_ingesta_log`: 100% de los puntos traían
   * ruta_id). Ahora `mi_config_tracking()` (server) decide por `comparte_ubicacion`
   * (rol chofer_transportista o el override por usuario) y da la cadencia.
   * Idempotente: si ya está rastreando, solo refresca la config.
   */
  async evaluarModoContinuo(): Promise<void> {
    if (this.evaluando) return;
    this.evaluando = true;
    try {
      const { data, error } = await this.supabase.client.rpc('mi_config_tracking');
      const cfg = (data as Array<Record<string, unknown>> | null)?.[0];
      if (error || !cfg) return; // sin sesión / offline: reintenta en el próximo resume
      if (!cfg['comparte']) {
        // No comparte ubicación (rol de oficina). Si venía en continuo (cambio de
        // sesión), apágalo.
        if (this.modoContinuo) {
          this.modoContinuo = false;
          await this.detenerTracking();
        }
        return;
      }
      this.distanceFilter = Number(cfg['distancia_m']) || DEFAULT_DISTANCE_FILTER;
      this.flushMs = (Number(cfg['flush_seg']) || FLUSH_MS / 1000) * 1000;
      this.modoContinuo = true;
      // Arranca (o mantiene) el tracking sin atarlo a una ruta.
      await this.iniciarTracking(this.vehiculoActual, undefined);
    } catch {
      /* best-effort: nunca romper el arranque de la app */
    } finally {
      this.evaluando = false;
    }
  }

  // ── AF27 — tracking en primer plano ─────────────────────────────────────────

  /** Arranca el reporte de posición. En modo continuo (AS1) corre todo el turno;
   *  con una ruta activa además etiqueta los puntos con la ruta. En nativo usa el
   *  foreground service (sigue en segundo plano); en web, watchPosition. */
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
            // AS1 — el tracking corre en continuo (todo el turno), no solo en ruta.
            backgroundMessage: 'Compartiendo tu ubicación con la empresa durante el trabajo.',
            backgroundTitle: 'CSD App — ubicación activa',
            requestPermissions: true,
            stale: false,
            distanceFilter: this.distanceFilter,
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
      this.flushTimer = setInterval(() => void this.flush(), this.flushMs);
      this.iniciarWatchdog();
      this.iniciarHeartbeat(); // AS1 — frescura aunque el chofer esté parado
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
    // Flags en LocalStore (Preferences en nativo → SOBREVIVEN a las actualizaciones
    // del APK; no se re-piden en cada ingreso). AT-batería.
    const KEY_ASKED = 'tracking_bateria_avisado';
    const KEY_GRANTED = 'tracking_bateria_concedida';

    // Solo llegamos aquí cuando el usuario COMPARTE ubicación (iniciarTracking se
    // dispara desde evaluarModoContinuo con comparte=true) → el permiso se pide
    // únicamente a quienes rastrean (AO6).
    if (await this.permissions.isIgnoringBattery()) {
      // Ya excluida: recuerda que estuvo concedida para detectar una revocación futura.
      try {
        await this.store.set(KEY_GRANTED, '1');
      } catch {
        /* best-effort */
      }
      return;
    }

    // No está excluida. Decidimos si pedirla:
    //  - fresca (nunca preguntada) → pedir una vez;
    //  - estuvo concedida y el SO la revocó → volver a pedir;
    //  - ya se preguntó y el usuario no la dio → NO insistir en cada ingreso.
    let debePedir = false;
    try {
      const concedidaAntes = (await this.store.get(KEY_GRANTED)) === '1';
      const yaPreguntada = (await this.store.get(KEY_ASKED)) === '1';
      if (concedidaAntes) {
        debePedir = true; // el SO la revocó → re-pedir
        await this.store.remove(KEY_GRANTED);
      } else if (!yaPreguntada) {
        debePedir = true; // primer ingreso → pedir una vez
      }
      if (debePedir) await this.store.set(KEY_ASKED, '1');
    } catch {
      // Si el store falla, pedimos igual (sin persistir el estado).
      debePedir = true;
    }
    if (!debePedir) return;

    // Diálogo nativo real (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) tras el toast.
    this.toast.withAction(
      'Para que tu ubicación se reporte con la pantalla apagada, permite que la app funcione sin restricción de batería.',
      { label: 'Permitir', run: () => void this.permissions.requestIgnoreBattery() },
      'info',
      12000,
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

  /**
   * Al completar/cancelar una ruta. En modo continuo (AS1, chofer que comparte
   * ubicación) NO se detiene el tracking: solo se quita la etiqueta de ruta y se
   * drena el lote — el chofer se sigue rastreando durante el turno. Solo se detiene
   * de verdad cuando el usuario NO comparte ubicación (oficina) o al cerrar sesión.
   */
  async detenerTracking(): Promise<void> {
    if (this.modoContinuo) {
      this.rutaActual = null; // la ruta terminó, el tracking continúa
      await this.flush();
      return;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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

  /** AU7 — fuerza un intento de subir el buffer offline ("N por sincronizar"). */
  async sincronizarAhora(): Promise<void> {
    await this.flush();
    await this.refrescarPendientes();
  }

  /** AS1 — apaga el tracking por completo (cierre de sesión / usuario sin permiso). */
  async apagar(): Promise<void> {
    this.modoContinuo = false;
    await this.detenerTracking();
  }

  private async push(lat: number, lng: number, precision: number | null): Promise<void> {
    // AU7 — persiste SIEMPRE a Dexie (nunca depende de la red). La subida es un
    // batch aparte (flush) que corre cuando hay conexión.
    try {
      await db.posiciones.add({
        lat,
        lng,
        precision,
        bateria: await this.bateria(),
        capturado_en: new Date().toISOString(),
        vehiculo_id: this.vehiculoActual,
        ruta_id: this.rutaActual,
      });
      this._pendientesSync.update((n) => n + 1);
    } catch {
      /* IndexedDB no disponible: el fix se pierde solo en el caso extremo de no poder escribir */
    }
    this.ultimoFix.set(Date.now());
    this.ultimaCoord = { lat, lng, precision }; // AS1 — para el latido de frescura
    if (this._pendientesSync() >= MAX_BUFFER) void this.flush();
  }

  // ── AS1 — latido de frescura ────────────────────────────────────────────────

  private iniciarHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => void this.heartbeatTick(), HEARTBEAT_MS);
  }

  /**
   * AS1 — si no llegó un fix nuevo del watcher (chofer parado: distanceFilter no
   * dispara), fuerza uno para que la última posición y el "hace X" se refresquen.
   * Si el fix falla, re-empuja la última coord con timestamp nuevo (heartbeat) —
   * no mueve el marcador, solo actualiza la frescura.
   */
  private async heartbeatTick(): Promise<void> {
    if (!this.rastreando()) return;
    const last = this.ultimoFix();
    // Solo si hace rato que no hay un fix del watcher (evita spam en movimiento).
    if (last != null && Date.now() - last < HEARTBEAT_MS - 5_000) return;
    try {
      const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 20_000 });
      if (r.ok) {
        await this.push(r.lat, r.lng, null);
        return;
      }
    } catch {
      /* cae al re-empuje de la última coord */
    }
    if (this.ultimaCoord) {
      await this.push(this.ultimaCoord.lat, this.ultimaCoord.lng, this.ultimaCoord.precision);
    }
  }

  /**
   * AU7 — sube el buffer de Dexie a `registrar_posiciones` por LOTES (FIFO por seq),
   * borrando cada lote solo tras confirmarse. Offline-first: sin señal no hace nada
   * y reintenta luego; el server acepta timestamps viejos (buffer offline) y
   * re-consolida el recorrido del día. Single-flight (QA-10).
   */
  private async flush(): Promise<void> {
    if (!this.net.online()) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      // Drena en varios lotes mientras queden puntos y haya señal.
      for (;;) {
        const lote = await db.posiciones.orderBy('seq').limit(FLUSH_BATCH).toArray();
        if (!lote.length) break;
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
          // AG11 — el rechazo del RPC (RLS/permiso/param) NO se traga en silencio.
          this.errors.report('tracking', 'registrar_posiciones rechazó el lote', {
            code: error.code,
            message: error.message,
            lote: lote.length,
          });
          return; // conserva el buffer para reintentar
        }
        // Borra EXACTAMENTE lo enviado (por seq); los push() concurrentes tienen seq
        // mayor y no entran en este lote → sin drift.
        await db.posiciones.bulkDelete(lote.map((p) => p.seq!).filter((s) => s != null));
        this.ultimaFlushOk = Date.now();
        await this.refrescarPendientes();
        if (!this.net.online()) break;
        if (lote.length < FLUSH_BATCH) break; // no quedaban más
      }
    } catch {
      /* sin señal / error de red → se reintenta (no es un fallo reportable) */
    } finally {
      this.flushing = false;
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
      buffer: this._pendientesSync(),
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

}
