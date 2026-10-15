import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Location } from '@angular/common';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { CAMBIO_LABEL, CambioItem, VersionService } from '../../core/services/version.service';
import { UpdaterService } from '../../core/services/updater.service';
import { UpdateService } from '../../core/services/update.service';
import { abrirUrlExterna } from '../../core/utils/abrir-url.util';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/**
 * V3/V4 — "Nueva versión disponible" screen. Reached from the update banner,
 * the version-check button (V2), and (V4) the in-app new-version notification.
 * Native: downloads the APK with a progress bar and launches the installer.
 * PWA: offers the direct download link.
 *
 * AJ1 — el changelog se pinta como bullets agrupados por módulo (campo
 * estructurado `cambios[]` con `{t,d,m}`); las versiones viejas (solo texto en
 * `notas`) caen a bullets por oración. El área del changelog scrollea con altura
 * limitada y los botones de abajo quedan SIEMPRE visibles.
 */
@Component({
  selector: 'app-actualizar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './actualizar.html',
  styleUrl: './actualizar.scss',
})
export class ActualizarPage implements OnDestroy {
  private versionSvc = inject(VersionService);
  private updater = inject(UpdaterService);
  private updates = inject(UpdateService);
  private location = inject(Location);

  esNativo = this.updater.esNativo;
  // CI7 — el canal decide qué textos se muestran (sin mencionar "APK" en play/appstore).
  // CL4 — `updater.canal` es el canal RESUELTO (defensivo): un binario nativo mal
  // construido con 'pwa' igual ofrece el flujo APK/tienda en vez de solo recargar.
  canal = this.updater.canal;
  esApk = this.updater.canal === 'apk';
  estado = this.updater.estado;
  progreso = this.updater.progreso;

  local = this.versionSvc.local;
  nueva = computed(() => this.versionSvc.etiquetaVersion);
  hayNueva = () => this.versionSvc.hayNueva();
  notas = () => this.versionSvc.notas;
  apkUrl = () => this.versionSvc.apkUrl;

  iniciado = signal(false);

  /** CL4 (F1.4) — "rescate": si el instalador del sistema NO apareció ~8s después de
   *  entregarle el APK (algunos ROMs lo tragan sin abrir nada), ofrecemos de forma
   *  VISIBLE "Descargar desde el navegador". Se arma tras el handoff y se cancela si
   *  la app pasa a background (el instalador abrió) o cambia de estado. */
  instaladorNoAbrio = signal(false);
  private hintTimer?: ReturnType<typeof setTimeout>;
  private pauseHandle?: PluginListenerHandle;

  /** AU10 — en la PWA no hay botón: al abrir esta pantalla (p. ej. por el deep-link
   *  de una notificación de versión) buscamos el build nuevo; si lo hay, el service
   *  worker lo activa y recarga solo. */
  buscandoPwa = signal(false);

  /** CO1 — el SW quedó degradado; ofrecer "Reparar la app" en vez de solo esperar. */
  necesitaReparar = this.updates.necesitaReparar;
  reparando = signal(false);

  /** Changelog estructurado de la versión publicada (best-effort, red). */
  private cambios = signal<CambioItem[]>([]);

  /** AJ1 — bullets agrupados por módulo, preservando el orden de aparición.
   *  Los cambios sin módulo caen a un grupo "General". */
  grupos = computed<{ modulo: string; items: CambioItem[] }[]>(() => {
    const orden: string[] = [];
    const mapa = new Map<string, CambioItem[]>();
    for (const c of this.cambios()) {
      const key = c.m && c.m.trim() ? c.m.trim() : 'General';
      if (!mapa.has(key)) {
        mapa.set(key, []);
        orden.push(key);
      }
      mapa.get(key)!.push(c);
    }
    return orden.map((m) => ({ modulo: m, items: mapa.get(m)! }));
  });

  /** Fallback plano: sin `cambios` estructurados, parte `notas` en renglones. */
  notasBullets = computed<string[]>(() => {
    if (this.cambios().length) return [];
    const n = this.notas();
    if (!n) return [];
    return n
      .split(/\r?\n|(?<=[.;])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  });

  hayChangelog = computed(() => this.cambios().length > 0 || this.notasBullets().length > 0);

  chipLabel = (t: string): string => CAMBIO_LABEL[t] ?? t;

  constructor() {
    void this.cargarCambios();
    // AU10 — PWA: no ofrecer descargas; disparar la búsqueda del SW y dejar que se
    // actualice sola. Si no hay nada nuevo, el toast lo confirma.
    if (!this.esNativo) {
      this.buscandoPwa.set(true);
      void this.updates.check().finally(() => this.buscandoPwa.set(false));
    }
  }

  private async cargarCambios(): Promise<void> {
    this.cambios.set(await this.versionSvc.cambiosPublicados());
  }

  async actualizar(): Promise<void> {
    this.iniciado.set(true);
    this.instaladorNoAbrio.set(false);
    this.cancelarHint();
    const ok = await this.updater.actualizar();
    // CL4 — solo APK nativo y cuando el instalador tomó el control (estado 'idle'):
    // si a los ~8s seguimos en foreground sin abrir nada, ofrece el navegador.
    if (ok && this.esApk && this.estado() === 'idle' && this.apkUrl()) {
      void this.armarHint();
    }
  }

  /** CL4 (F1.4) — descarga el APK publicado desde el navegador del sistema
   *  (último recurso cuando el instalador in-app no aparece). Degradable: sin apkUrl
   *  el botón ni se pinta. `@capacitor/browser` no está instalado → se usa el helper
   *  abrirUrlExterna (AppLauncher en nativo / window.open en PWA). */
  descargarNavegador(): void {
    const url = this.apkUrl();
    if (url) void abrirUrlExterna(url);
    this.instaladorNoAbrio.set(false);
  }

  /** Arma el temporizador de 8s + el listener de 'pause' (background = instalador abrió). */
  private async armarHint(): Promise<void> {
    this.cancelarHint();
    this.pauseHandle = await App.addListener('pause', () => this.cancelarHint());
    this.hintTimer = setTimeout(() => {
      // Seguimos en foreground y sin permiso/error pendiente → el instalador no apareció.
      if (this.estado() === 'idle') this.instaladorNoAbrio.set(true);
      void this.pauseHandle?.remove();
      this.pauseHandle = undefined;
      this.hintTimer = undefined;
    }, 8000);
  }

  private cancelarHint(): void {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = undefined;
    }
    void this.pauseHandle?.remove();
    this.pauseHandle = undefined;
  }

  ngOnDestroy(): void {
    this.cancelarHint();
  }

  abrirAjustes(): void {
    void this.updater.abrirAjustesPermiso();
  }

  /** CO1 — "Reparar la app" (solo PWA). */
  async reparar(): Promise<void> {
    if (this.esNativo || this.reparando()) return;
    this.reparando.set(true);
    try {
      await this.updates.reparar();
    } finally {
      this.reparando.set(false);
    }
  }

  volver(): void {
    this.location.back();
  }
}
