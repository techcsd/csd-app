import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { esEmailSintetico } from '../../core/util/usuario-email';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { environment } from '../../../environments/environment';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';
import { UpdateService } from '../../core/services/update.service';
import { NetworkService } from '../../core/services/network.service';
import { BiometricService } from '../../core/services/biometric.service';
import { WebauthnService } from '../../core/services/webauthn.service';
import { VersionService } from '../../core/services/version.service';
import { ToastService } from '../../core/services/toast.service';
import { CameraService } from '../../core/services/camera.service';
import { PushService } from '../../core/services/push.service';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AvatarEditor } from '../../shared/ui/avatar-editor/avatar-editor';
import { LanguageSelector } from '../../shared/ui/language-selector/language-selector';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ThemeService, ThemePref } from '../../core/services/theme.service';
import { FormsModule } from '@angular/forms';

/** Profile / settings: identity, app version, update check, logout. */
@Component({
  selector: 'app-perfil',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog, AvatarEditor, LanguageSelector, TranslatePipe, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.scss',
})
export class PerfilPage {
  protected theme = inject(ThemeService);
  private ctx = inject(UserContextService);
  private session = inject(SessionService);
  private updates = inject(UpdateService);
  private network = inject(NetworkService);
  private biometric = inject(BiometricService);
  private webauthn = inject(WebauthnService);
  private versionSvc = inject(VersionService);
  private toast = inject(ToastService);
  private camera = inject(CameraService);
  private push = inject(PushService);
  private router = inject(Router);
  private location = inject(Location);

  nombre = this.ctx.nombre;
  telefono = this.ctx.telefono; // AY1
  roles = this.ctx.roles;
  // AY1 — edición self-service de nombre + teléfono.
  editando = signal(false);
  nombreEdit = signal('');
  telefonoEdit = signal('');
  guardandoPerfil = signal(false);
  // AW7 — foto de perfil.
  avatarUrl = this.ctx.miAvatarUrl;
  // BT3 — si la imagen falla al cargar (URL caducada/red), caemos a la inicial en vez
  // de dejar el ícono roto (que se ve como un "logo genérico"). Se resetea al cambiarla.
  avatarFallo = signal(false);
  editorImagen = signal<Blob | null>(null);
  subiendoFoto = signal(false);
  obra = this.ctx.obraActiva;
  isAdmin = () => this.ctx.hasModulo('admin');
  // BV8 — "A mi cargo": ingenieros/encargados (responsables de obra). Gating amplio como
  // Personal de obra; el RPC materiales_a_cargo acota los datos a las obras del usuario.
  puedeVerACargo = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('ingenieria') ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.puedeVerSubmodulo('proyectos.obras') ||
      this.ctx.puedeVerObra(),
  );
  // BI6 (FASE 5) — un usuario de acceso por cédula (email sintético) puede cambiar su
  // PIN de acceso él mismo. Los de correo real usan el restablecimiento por correo.
  esCedula = computed(() => esEmailSintetico(this.ctx.profile()?.email));
  // BD1 — preferencia por usuario: agrupar el home por sección (off por defecto).
  agrupado = this.ctx.agruparHome;
  agrupadoBusy = signal(false);
  online = this.network.online;
  // BS3 — Apariencia (claro/oscuro/sistema). Nombres/orden alineados con el módulo
  // Configuración de la web. 'sistema' = sigue el tema del teléfono.
  readonly aparienciaOpts: { pref: ThemePref; label: string; icon: string }[] = [
    { pref: 'claro', label: 'Claro', icon: '☀️' },
    { pref: 'oscuro', label: 'Oscuro', icon: '🌙' },
    { pref: 'sistema', label: 'Automático', icon: '📱' },
  ];
  version = environment.version;
  versionPublicada = () => this.versionSvc.etiquetaVersion;
  hayNueva = () => this.versionSvc.hayNueva();
  // BU1 F1.2 — Acerca de: entorno + ref corto (+ aviso de push en el build dev).
  entorno = environment.entorno;
  esDev = environment.entorno === 'dev';
  refCorto = (() => {
    try { return new URL(environment.supabaseUrl).hostname.split('.')[0].slice(0, 8); }
    catch { return '—'; }
  })();
  pushDisponible = () => !this.push.soportado || this.push.disponible;
  checking = signal(false);
  confirmLogout = signal(false);
  biometriaSoportada = signal(false);
  biometriaOn = signal(false);
  biometriaBusy = signal(false);
  faceIdSoportado = signal(false); // X8 — PWA (Face ID/Touch ID vía WebAuthn)
  faceIdOn = signal(false);
  faceIdBusy = signal(false);

  constructor() {
    void this.loadBiometria();
  }

  /** BS3 — cambia la apariencia (claro/oscuro/sistema). Sincroniza con la web. */
  setApariencia(pref: ThemePref): void {
    void this.theme.setPref(pref);
  }

  private async loadBiometria(): Promise<void> {
    this.biometriaSoportada.set(await this.biometric.isSupported());
    this.biometriaOn.set(await this.biometric.isEnabled());
    // X8 — en el PWA (iPhone) el desbloqueo biométrico va por WebAuthn.
    this.faceIdSoportado.set(await this.webauthn.isSupported());
    this.faceIdOn.set(await this.webauthn.isEnabled());
  }

  async toggleFaceId(): Promise<void> {
    if (this.faceIdBusy()) return;
    this.faceIdBusy.set(true);
    try {
      const next = !this.faceIdOn();
      const result = await this.webauthn.setEnabled(next);
      this.faceIdOn.set(result);
      if (next && !result) {
        this.toast.error('No se pudo activar Face ID. Inténtalo de nuevo.');
      } else if (result) {
        this.toast.success('Desbloqueo con Face ID activado.');
      } else {
        this.toast.success('Face ID desactivado.');
      }
    } finally {
      this.faceIdBusy.set(false);
    }
  }

  /**
   * BD1 — alterna el home agrupado por sección (preferencia por usuario, server-side).
   * Requiere conexión (se persiste en el servidor para sobrevivir reinstalaciones y
   * valer en todos los dispositivos del usuario).
   */
  async toggleAgrupado(): Promise<void> {
    if (this.agrupadoBusy()) return;
    if (!this.online()) {
      this.toast.error('Necesitas conexión para cambiar esta preferencia.');
      return;
    }
    this.agrupadoBusy.set(true);
    try {
      const next = !this.agrupado();
      await this.ctx.setPreferencia('agrupar_home', next);
      this.toast.success(next ? 'Módulos agrupados por sección.' : 'Módulos en cuadrícula (por defecto).');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la preferencia.');
    } finally {
      this.agrupadoBusy.set(false);
    }
  }

  /** X10 — cambiar el BLOQUEO local de la app (PIN de 4 díg del dispositivo). */
  cambiarPin(): void {
    void this.router.navigate(['/auth/pin-change']);
  }

  /** BI6 (FASE 5) — cambiar el PIN de ACCESO (6 díg, servidor) — solo cédula. */
  cambiarPinAcceso(): void {
    void this.router.navigate(['/auth/pin-acceso-change']);
  }

  async toggleBiometria(): Promise<void> {
    if (this.biometriaBusy()) return;
    this.biometriaBusy.set(true);
    try {
      const next = !this.biometriaOn();
      const result = await this.biometric.setEnabled(next);
      this.biometriaOn.set(result);
      if (next && !result) {
        this.toast.error('No se pudo activar la biometría. Usa tu huella o rostro registrados.');
      } else if (result) {
        this.toast.success('Desbloqueo por huella / rostro activado.');
      } else {
        this.toast.success('Desbloqueo biométrico desactivado.');
      }
    } finally {
      this.biometriaBusy.set(false);
    }
  }

  async buscarActualizacion(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
      // V2: the honest source of truth for "is there a newer version" is the
      // published record in SGC — read it FRESH (never the cached value that
      // made this button lie on the APK). Only then fall back to the PWA SW.
      const online = await this.versionSvc.checkFresh();
      if (!online) {
        this.toast.error('Sin señal. No pude verificar si hay una versión nueva.');
        return;
      }
      if (this.versionSvc.hayNueva()) {
        const pub = this.versionSvc.etiquetaVersion;
        this.toast.show(`Hay una versión nueva (${pub}) disponible.`, 'info', 4000);
        void this.router.navigate(['/actualizar']);
        return;
      }
      // No newer published build. On the PWA, still let the service worker pull
      // fresh web assets; on native this just confirms "up to date".
      await this.updates.check();
    } finally {
      this.checking.set(false);
    }
  }

  /** BF4 — abre la bandeja de avisos con las preferencias desplegadas (silenciar
   *  los avisos informativos; los operativos no se pueden silenciar). */
  preferenciasAvisos(): void {
    void this.router.navigate(['/avisos'], { queryParams: { prefs: '1' } });
  }

  enProceso(): void {
    void this.router.navigate(['/en-proceso']);
  }

  reportar(): void {
    void this.router.navigate(['/reportar']);
  }

  soporte(): void {
    void this.router.navigate(['/soporte']);
  }

  /** Z26 — el encabezado (avatar + nombre + rol) abre el detalle de mi propio usuario. */
  verMiDetalle(): void {
    void this.router.navigate(['/perfil/mi-detalle']);
  }

  /** BV8 — "Materiales a mi cargo" (ingenieros/encargados). */
  aMiCargo(): void {
    void this.router.navigate(['/perfil/a-mi-cargo']);
  }

  /** AW7 — elegir una foto de perfil → editor (recorte circular) → subir. */
  async cambiarMiFoto(desde: 'camara' | 'galeria'): Promise<void> {
    if (this.subiendoFoto()) return;
    const foto =
      desde === 'camara' ? await this.camera.takePhoto() : (await this.camera.pickFromGallery(1))[0] ?? null;
    if (!foto) return;
    this.editorImagen.set(foto.blob);
  }
  async onFotoEditada(blob: Blob): Promise<void> {
    this.editorImagen.set(null);
    this.subiendoFoto.set(true);
    try {
      await this.ctx.actualizarMiAvatar(blob);
      this.avatarFallo.set(false); // BT3 — nueva foto: reintenta mostrarla
      this.toast.success('Foto de perfil actualizada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar la foto.');
    } finally {
      this.subiendoFoto.set(false);
    }
  }
  onFotoCancel(): void {
    this.editorImagen.set(null);
  }

  /** AY1 — abre el modo edición de mi perfil (nombre + teléfono). */
  editarPerfil(): void {
    this.nombreEdit.set(this.nombre());
    this.telefonoEdit.set(this.telefono());
    this.editando.set(true);
  }
  cancelarEdicion(): void {
    this.editando.set(false);
  }
  async guardarPerfil(): Promise<void> {
    if (this.guardandoPerfil()) return;
    if (!this.nombreEdit().trim()) {
      this.toast.error('El nombre no puede quedar vacío.');
      return;
    }
    if (!this.online()) {
      this.toast.error('Necesitas conexión para actualizar tu perfil.');
      return;
    }
    this.guardandoPerfil.set(true);
    try {
      await this.ctx.actualizarMiPerfil(this.nombreEdit().trim(), this.telefonoEdit().trim());
      this.toast.success('Perfil actualizado.');
      this.editando.set(false);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar el perfil.');
    } finally {
      this.guardandoPerfil.set(false);
    }
  }

  /** Z24 — abrir la web del SGC en el navegador del sistema.
   *  Nativo → AppLauncher; web/PWA (o si falla) → window.open '_system'.
   *  Mismo patrón probado que conduces.ts comoLlegar(). */
  async abrirWeb(): Promise<void> {
    const url = environment.appUrl;
    if (Capacitor.isNativePlatform()) {
      try {
        await AppLauncher.openUrl({ url });
        return;
      } catch {
        /* cae al fallback window.open */
      }
    }
    window.open(url, '_system');
  }

  admin(): void {
    void this.router.navigate(['/admin']);
  }

  /** Ask before signing out — a stray tap in the field shouldn't kick the user
   *  out and force a full password + PIN re-setup. */
  pedirCerrarSesion(): void {
    this.confirmLogout.set(true);
  }

  cancelarCerrarSesion(): void {
    this.confirmLogout.set(false);
  }

  async logout(): Promise<void> {
    this.confirmLogout.set(false);
    await this.session.logout();
    await this.router.navigate(['/auth/login']);
  }

  back(): void {
    this.location.back();
  }
}
