import { computed, inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';
import { UserContextService } from './user-context.service';
import { PermissionsService } from './permissions.service';
import { UbicacionDisclosureGate } from './ubicacion-disclosure-gate.service';
import { PoliticasService } from './politicas.service';
import { IdiomaOnboardingService } from '../i18n/idioma-onboarding.service';
import { I18nService, Idioma } from '../i18n/i18n.service';

/** Marca LOCAL por usuario+dispositivo: esta cuenta ya vio la bienvenida v2 aquí. */
const FLAG_PREFIX = 'bienvenida_v2:';
/** Flag del onboarding de permisos (shared/components/permisos-onboarding): al mostrar
 *  la bienvenida lo consumimos para que no salga como una SEGUNDA ventana. */
const PERMISOS_FLAG = 'csd_permisos_onboarding_v2';
/** Flag del tour con foco (shared/components/onboarding): si ya corrió, la bienvenida
 *  es "existente" y no se fuerza. */
const TOUR_FLAG = 'csd_onboarding_v1_done';
/** Marca local del diálogo de idioma (la escribe IdiomaOnboardingService con
 *  Preferences SIN prefijo de entorno). */
const IDIOMA_FLAG = 'idioma_elegido';
/** Clave del flag de servidor (PROMPT-92 F6.1). Puede NO existir aún en dev → el
 *  acceso va detrás de comprobación de capacidad (best-effort, nunca bloquea). */
const SERVER_KEY = 'bienvenida_app_v2_vista';

export type PasoPermiso = 'idle' | 'ok' | 'no';

/** Escena animada del saludo por rol (paso 2). */
export type SaludoAnim = 'camion' | 'obra' | 'cajas' | 'tablero' | 'generico';

export interface Saludo {
  /** Clave de escena para el <svg> del paso 2. */
  anim: SaludoAnim;
  /** Etiqueta del rol para "Como {rol}, …" (texto ES, pasa por `| t`). */
  rol: string;
  /** Tres cosas que hace ese rol (textos ES, pasan por `| t`). */
  cosas: string[];
}

/**
 * CL3 (PROMPT-93 F5) — orquestador ÚNICO de la bienvenida animada de la app. Reúne las
 * piezas que antes se encadenaban como ventanas sueltas (idioma, aceptación de políticas,
 * consentimiento de ubicación, permisos) en UN solo flujo de 6 pasos, SIN reimplementar
 * sus efectos: cada paso llama al MISMO servicio que ya grababa su registro.
 *
 * - Idioma          → IdiomaOnboardingService.confirmar() (sella `idioma_elegido_at`).
 * - Políticas       → PoliticasService.aceptarTodas() (aceptación versionada).
 * - Ubicación       → UbicacionDisclosureGate.forzar() (prominent disclosure + consent
 *                     `ubicacion_fondo` + permiso del SO).
 * - Notificaciones  → PushNotifications.requestPermissions() (igual que permisos-onboarding).
 *
 * El consentimiento de IA (CI10) NO va aquí: sigue pidiéndose en contexto (primer uso de
 * Compa). Al terminar, entrega al tour con foco (`shared/components/onboarding`).
 *
 * ¿Cuándo sale? Primera instalación o primer login de ese usuario en ese teléfono. Gate =
 * flag local `bienvenida_v2:<usuario>` + flag de servidor `bienvenida_app_v2_vista` (con
 * fallback a solo-local si el servidor aún no lo tiene). A los usuarios EXISTENTES no se
 * les fuerza (si ya pasaron tour/idioma/permisos, se marca visto en silencio). Escotilla
 * de dev: `?bienvenida=1`.
 */
@Injectable({ providedIn: 'root' })
export class BienvenidaService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);
  private ctx = inject(UserContextService);
  private permissions = inject(PermissionsService);
  private disclosure = inject(UbicacionDisclosureGate);
  private politicas = inject(PoliticasService);
  private idiomaOnboarding = inject(IdiomaOnboardingService);
  private i18n = inject(I18nService);
  private router = inject(Router);

  private _mostrar = signal(false);
  /** El shell pinta el overlay cuando esto es true. */
  readonly mostrar = this._mostrar.asReadonly();

  private _paso = signal(0);
  /** Paso actual (0 logo … 5 "todo listo"). */
  readonly paso = this._paso.asReadonly();

  private _idiomaSel = signal<Idioma>('es');
  readonly idiomaSel = this._idiomaSel.asReadonly();

  private _notif = signal<PasoPermiso>('idle');
  readonly notif = this._notif.asReadonly();
  private _ubic = signal<PasoPermiso>('idle');
  readonly ubic = this._ubic.asReadonly();

  private _aceptaPoliticas = signal(true);
  readonly aceptaPoliticas = this._aceptaPoliticas.asReadonly();

  /** Token que el tour con foco observa: al terminar la bienvenida, lo lanzamos. */
  private _tourSolicitado = signal(0);
  readonly tourSolicitado = this._tourSolicitado.asReadonly();

  /** Promesa que resuelve si la bienvenida se MOSTRARÁ en este arranque. La usan
   *  permisos-onboarding y el tour para subordinarse (no salir como 2ª ventana /
   *  esperar el relevo). Resuelve una sola vez (en la primera `evaluar`). */
  readonly decision: Promise<boolean>;
  private resolverDecision!: (v: boolean) => void;

  private decidido = false;
  private evaluando = false;

  constructor() {
    this.decision = new Promise<boolean>((res) => (this.resolverDecision = res));
  }

  // ── Datos derivados para la plantilla ─────────────────────────────────────

  /** Primer nombre para "Hola, {nombre}". */
  nombreCorto = computed(() => (this.ctx.nombre().trim().split(/\s+/)[0] || '').trim());

  /** Idiomas HABILITADOS (igual criterio que el selector de primer ingreso). */
  idiomas = computed(() =>
    this.i18n
      .estadoIdiomas()
      .filter((e) => !e.deshabilitado)
      .map((e) => ({ code: e.code, nativo: e.nativo })),
  );

  /** Saludo por rol (paso 2): escena + etiqueta + 3 cosas que hace ese rol. */
  saludo = computed<Saludo>(() => {
    const c = this.ctx;
    if (c.esChofer()) {
      return {
        anim: 'camion',
        rol: 'chofer',
        cosas: ['Tus rutas y entregas', 'Combustible con foto del recibo', 'Conduces firmados en la obra'],
      };
    }
    if (c.hasModulo('obra') || c.hasModulo('proyectos') || c.puedeVerObra()) {
      return {
        anim: 'obra',
        rol: 'ingeniero',
        cosas: ['Tus bitácoras de obra', 'Requisiciones de material', 'Órdenes de trabajo'],
      };
    }
    if (c.hasRol('logistica') || c.hasModulo('inventario')) {
      return {
        anim: 'cajas',
        rol: 'almacén',
        cosas: ['Entradas y salidas de material', 'Recibir y despachar', 'Conteos e inventario'],
      };
    }
    if (c.esAdmin() || c.hasRol('gerencia') || c.hasRol('direccion')) {
      return {
        anim: 'tablero',
        rol: 'administrador',
        cosas: ['Todo el movimiento de tu equipo', 'Aprobaciones y firmas', 'Resumen y reportes'],
      };
    }
    return {
      anim: 'generico',
      rol: 'parte del equipo',
      cosas: ['Tus tareas del día', 'Trabaja aunque no haya señal', 'Todo a un solo toque'],
    };
  });

  /** Partículas del estallido final (paso 5). */
  readonly bits = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const cols = ['#f97316', '#fb923c', '#9cc0ec', '#4ade80', '#ffffff'];
    return { c: cols[i % 5], x: Math.round(Math.cos(a) * 95) + 'px', y: Math.round(Math.sin(a) * 95) + 'px' };
  });

  // ── Acciones de pasos ─────────────────────────────────────────────────────

  elegirIdioma(code: Idioma): void {
    this._idiomaSel.set(code);
    // Vista previa en vivo: aplica el idioma localmente (sin escribir el servidor; el
    // sellado real va en `confirmar` al pasar de paso).
    void this.i18n.adoptFromServer(code);
  }

  togglePoliticas(v: boolean): void {
    this._aceptaPoliticas.set(v);
  }

  /** Abre la página legal (misma URL pública que la pantalla de aceptación). */
  abrirPolitica(doc: 'privacidad' | 'terminos'): void {
    void this.politicas.abrir(doc);
  }

  /** Paso 4 — Notificaciones: MISMA solicitud que permisos-onboarding (FCM en nativo). */
  async pedirNotificaciones(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        const r = await PushNotifications.requestPermissions();
        this._notif.set(r.receive === 'granted' ? 'ok' : 'no');
      } else {
        const r = await this.permissions.requestNotifications();
        this._notif.set(r === 'granted' ? 'ok' : 'no');
      }
    } catch {
      this._notif.set('no');
    }
  }

  /** Paso 4 — Ubicación: reusa el prominent disclosure (CI5). Graba el MISMO consent
   *  `ubicacion_fondo` y pide el MISMO permiso del SO que el flujo actual. */
  async pedirUbicacion(): Promise<void> {
    try {
      const ok = await this.disclosure.forzar();
      this._ubic.set(ok ? 'ok' : 'no');
    } catch {
      this._ubic.set('no');
    }
  }

  /** Avanza al siguiente paso, sellando los efectos del paso que se deja atrás. */
  async siguiente(): Promise<void> {
    const s = this._paso();
    // Al dejar IDIOMA: sella la elección (usuarios.idioma + idioma_elegido_at), MISMO
    // registro que el diálogo de primer ingreso.
    if (s === 1) {
      try {
        await this.idiomaOnboarding.confirmar(this._idiomaSel());
      } catch {
        /* best-effort: el idioma local ya se aplicó en la vista previa */
      }
    }
    // Al dejar PERMISOS: si marcó la casilla y hay políticas vigentes, acepta la versión
    // (aceptación versionada; MISMO registro que la pantalla de aceptación).
    if (s === 4 && this._aceptaPoliticas() && this.politicas.hayPendientes()) {
      try {
        await this.politicas.aceptarTodas();
      } catch {
        /* si falla, la pantalla de aceptación (fallback) lo exige al cerrar la bienvenida */
      }
    }
    const next = Math.min(5, s + 1);
    this._paso.set(next);
    if (next === 5) void this.vibrarFinal();
  }

  /** "Saltar": salta al paso final (como el mock). Lo no elegido (idioma/políticas) lo
   *  exigen sus gates de respaldo al cerrar. */
  saltar(): void {
    this._paso.set(5);
    void this.vibrarFinal();
  }

  /** Paso 5 — "Ir a mi inicio": cierra, marca visto y entrega al tour con foco. */
  async terminar(): Promise<void> {
    await this.marcarVista();
    this._mostrar.set(false);
    this._paso.set(0);
    try {
      if (!this.router.url.startsWith('/home')) await this.router.navigateByUrl('/home');
    } catch {
      /* best-effort */
    }
    // Relevo al tour con foco (shared/components/onboarding).
    this._tourSolicitado.update((n) => n + 1);
  }

  /** CM7 — "Practicar primero": cierra la bienvenida (marca vista) y abre el modo
   *  práctica en vez del tour. No obligatorio: es una invitación al final del flujo. */
  async practicar(): Promise<void> {
    await this.marcarVista();
    this._mostrar.set(false);
    this._paso.set(0);
    try {
      await this.router.navigateByUrl('/practica');
    } catch {
      /* best-effort */
    }
  }

  // ── Gate ──────────────────────────────────────────────────────────────────

  /**
   * Decide si mostrar la bienvenida. Idempotente: se llama tras el primer login y en
   * cada arranque con sesión (fuera de /auth). No lanza nunca; resuelve `decision` una
   * sola vez.
   */
  async evaluar(): Promise<void> {
    if (this.decidido || this.evaluando) return;
    this.evaluando = true;
    try {
      // Escotilla de dev: ?bienvenida=1 fuerza el flujo (ignora flags).
      if (this.devHatch()) {
        await this.abrir();
        return;
      }

      const uid = this.ctx.profile()?.id;
      if (!uid) return; // perfil aún no cargado → reintentar en la próxima navegación

      // 1) Flag local por usuario → ya la vio aquí.
      if ((await this.store.get(FLAG_PREFIX + uid)) === '1') {
        this.cerrarDecision(false);
        return;
      }

      // 2) Usuario EXISTENTE (instaló/usó una versión anterior): no se fuerza. Si ya
      //    pasó el tour, el idioma o los permisos, se marca visto en silencio.
      if (await this.esExistente()) {
        await this.store.set(FLAG_PREFIX + uid, '1');
        this.cerrarDecision(false);
        return;
      }

      // 3) Servidor (capacidad): ¿ya la vio en otro dispositivo? Si el flag no existe
      //    aún en este entorno, se cae a solo-local (nunca bloquea).
      if (await this.vistoEnServidor()) {
        await this.store.set(FLAG_PREFIX + uid, '1');
        this.cerrarDecision(false);
        return;
      }

      // 4) Mostrar.
      await this.abrir();
    } finally {
      this.evaluando = false;
    }
  }

  /** "Ver la bienvenida otra vez" (Soporte y ayuda). Reinicia y muestra el flujo. */
  async verOtraVez(): Promise<void> {
    this._notif.set('idle');
    this._ubic.set('idle');
    this._aceptaPoliticas.set(true);
    this._idiomaSel.set(this.i18n.idioma());
    this._paso.set(0);
    this._mostrar.set(true);
  }

  private async abrir(): Promise<void> {
    this.decidido = true;
    this._idiomaSel.set(this.i18n.idioma());
    this._paso.set(0);
    // Consume el flag de permisos para que ese onboarding no salga como 2ª ventana.
    try {
      await this.store.set(PERMISOS_FLAG, '1');
    } catch {
      /* best-effort */
    }
    this._mostrar.set(true);
    this.cerrarDecision(true);
  }

  private cerrarDecision(v: boolean): void {
    this.decidido = true;
    this.resolverDecision(v);
  }

  private devHatch(): boolean {
    try {
      return new URLSearchParams(location.search).get('bienvenida') === '1';
    } catch {
      return false;
    }
  }

  /** ¿Instalación/usuario ya "onboardeado" antes? (tour hecho, idioma elegido o permisos
   *  pedidos). Device-level: en un teléfono compartido, un 2º usuario no re-ve el flujo. */
  private async esExistente(): Promise<boolean> {
    try {
      if ((await this.store.get(TOUR_FLAG)) === '1') return true;
      if ((await this.store.get(PERMISOS_FLAG)) === '1') return true;
    } catch {
      /* best-effort */
    }
    try {
      // IdiomaOnboardingService escribe esta clave con Preferences SIN prefijo de entorno.
      if ((await Preferences.get({ key: IDIOMA_FLAG })).value === '1') return true;
    } catch {
      /* best-effort */
    }
    return false;
  }

  /** Lee el flag de servidor por capacidad (best-effort). false si no existe/offline. */
  private async vistoEnServidor(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.rpc('mis_preferencias');
      if (error || !data) return false;
      const prefs = data as Record<string, unknown>;
      return prefs[SERVER_KEY] === true || prefs[SERVER_KEY] === '1';
    } catch {
      return false;
    }
  }

  /** Marca la bienvenida como vista: local (por usuario) + servidor (best-effort). */
  private async marcarVista(): Promise<void> {
    const uid = this.ctx.profile()?.id;
    try {
      if (uid) await this.store.set(FLAG_PREFIX + uid, '1');
    } catch {
      /* best-effort */
    }
    // Servidor (capacidad): si la RPC/clave aún no existe, se ignora sin romper nada.
    try {
      await this.supabase.client.rpc('set_mi_preferencia', { p_clave: SERVER_KEY, p_valor: true });
    } catch {
      /* best-effort: el flag local ya evita re-mostrarla en este dispositivo */
    }
  }

  private async vibrarFinal(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      try {
        navigator.vibrate?.([40, 60, 40]);
      } catch {
        /* sin motor de vibración */
      }
      return;
    }
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      /* plugin ausente → sin vibración */
    }
  }
}
