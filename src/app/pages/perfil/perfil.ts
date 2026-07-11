import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';
import { UpdateService } from '../../core/services/update.service';
import { NetworkService } from '../../core/services/network.service';
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
  private router = inject(Router);
  private location = inject(Location);

  nombre = this.ctx.nombre;
  roles = this.ctx.roles;
  obra = this.ctx.obraActiva;
  isAdmin = () => this.ctx.hasModulo('admin');
  online = this.network.online;
  version = environment.version;
  checking = signal(false);
  confirmLogout = signal(false);

  async buscarActualizacion(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
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
