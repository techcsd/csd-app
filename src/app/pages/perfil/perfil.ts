import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';
import { UpdateService } from '../../core/services/update.service';
import { NetworkService } from '../../core/services/network.service';

/** Profile / settings: identity, app version, update check, logout. */
@Component({
  selector: 'app-perfil',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  online = this.network.online;
  version = environment.version;
  checking = signal(false);

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

  async logout(): Promise<void> {
    await this.session.logout();
    await this.router.navigate(['/auth/login']);
  }

  back(): void {
    this.location.back();
  }
}
