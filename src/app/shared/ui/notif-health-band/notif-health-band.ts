import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NotifHealthService } from '../../../core/services/notif-health.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * CK10 (parte B) — cinta GLOBAL de salud de notificaciones. Si `NotifHealthService`
 * dice que están apagadas o sin sonido, pinta una cinta ámbar accionable ("Activar"
 * → ajustes de la app). Para los CHOFERES NO se puede cerrar (deben recibir los avisos
 * de obra); para el resto tiene una ✕ que la oculta por lo que resta de la sesión.
 *
 * La evaluación (`evaluar()`) la dispara el shell al abrir la app; aquí solo leemos la
 * señal cacheada y decidimos si se ve.
 */
@Component({
  selector: 'app-notif-health-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './notif-health-band.html',
  styleUrl: './notif-health-band.scss',
})
export class NotifHealthBand {
  private health = inject(NotifHealthService);
  private permissions = inject(PermissionsService);
  private ctx = inject(UserContextService);
  private router = inject(Router);

  /** Cerrada por el usuario en esta sesión (no aplica a choferes). */
  private cerrada = signal(false);

  salud = this.health.salud;
  // CG6 — el chofer (de flota o privado) tiene la experiencia reducida y DEPENDE de los
  // avisos; no puede descartar la cinta.
  esChofer = computed(() => this.ctx.esChofer());

  visible = computed(() => {
    const s = this.salud();
    if (!s || s.ok) return false;
    if (this.cerrada() && !this.esChofer()) return false;
    return true;
  });

  activar(): void {
    void this.permissions.openAppSettings();
  }

  verGuia(): void {
    void this.router.navigate(['/soporte'], { queryParams: { seccion: 'notificaciones' } });
  }

  cerrar(): void {
    this.cerrada.set(true);
  }
}
