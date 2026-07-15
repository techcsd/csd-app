import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';
import { UpdateService } from '../../core/services/update.service';
import { NetworkService } from '../../core/services/network.service';
import { BiometricService } from '../../core/services/biometric.service';
import { VersionService } from '../../core/services/version.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';

/** Profile / settings: identity, app version, update check, logout. */
@Component({
  selector: 'app-perfil',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog],
  templateUrl: './perfil.html',
  styleUrl: './perfil.scss',
})
export class PerfilPage {
  private ctx = inject(UserContextService);
  private session = inject(SessionService);
  private updates = inject(UpdateService);
  private network = inject(NetworkService);
  private biometric = inject(BiometricService);
  private versionSvc = inject(VersionService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  nombre = this.ctx.nombre;
  roles = this.ctx.roles;
  obra = this.ctx.obraActiva;
  isAdmin = () => this.ctx.hasModulo('admin');
  online = this.network.online;
  version = environment.version;
  versionPublicada = () => this.versionSvc.etiquetaVersion;
  hayNueva = () => this.versionSvc.hayNueva();
  checking = signal(false);
  confirmLogout = signal(false);
  biometriaSoportada = signal(false);
  biometriaOn = signal(false);
  biometriaBusy = signal(false);

  constructor() {
    void this.loadBiometria();
  }

  private async loadBiometria(): Promise<void> {
    this.biometriaSoportada.set(await this.biometric.isSupported());
    this.biometriaOn.set(await this.biometric.isEnabled());
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

  reportar(): void {
    void this.router.navigate(['/reportar']);
  }

  soporte(): void {
    void this.router.navigate(['/soporte']);
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
