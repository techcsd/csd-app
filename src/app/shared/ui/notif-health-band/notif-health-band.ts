import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { NotifHealthService } from '../../../core/services/notif-health.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PushWebService } from '../../../core/services/push-web.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';

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
  imports: [TranslatePipe, BottomSheet],
  templateUrl: './notif-health-band.html',
  styleUrl: './notif-health-band.scss',
})
export class NotifHealthBand {
  private health = inject(NotifHealthService);
  private permissions = inject(PermissionsService);
  private pushWeb = inject(PushWebService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  /** Cerrada por el usuario en esta sesión (no aplica a choferes). */
  private cerrada = signal(false);

  /** CO10/CO17 — hojas de la PWA según el caso (permiso negado / no instalada). */
  mostrarDenegado = signal(false);
  mostrarInstalar = signal(false);
  activando = signal(false);

  readonly esNativo = Capacitor.isNativePlatform();

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

  /**
   * CO10/CO17 — en nativo sigue igual (abrir ajustes del sistema). En la PWA,
   * `permissions.openAppSettings()` es no-op (CO10: por eso "Activar" no hacía
   * nada) — aquí se resuelve según el caso real del equipo.
   */
  async activar(): Promise<void> {
    if (this.esNativo) {
      void this.permissions.openAppSettings();
      return;
    }
    if (!this.pushWeb.instalada()) {
      this.mostrarInstalar.set(true);
      return;
    }
    if (this.pushWeb.permiso() === 'denied') {
      this.mostrarDenegado.set(true);
      return;
    }
    await this.pedirYSuscribir();
  }

  /** "Ya lo activé, comprobar" dentro de la hoja de permiso negado. */
  async comprobar(): Promise<void> {
    if (this.pushWeb.permiso() !== 'granted') {
      this.toast.error(this.i18n.t('Todavía están apagadas. Sigue los pasos de arriba.'));
      return;
    }
    const ok = await this.pedirYSuscribir();
    if (ok) this.mostrarDenegado.set(false);
  }

  private async pedirYSuscribir(): Promise<boolean> {
    if (this.activando()) return false;
    this.activando.set(true);
    try {
      const ok = await this.pushWeb.activar();
      if (ok) {
        this.toast.success(this.i18n.t('Notificaciones activadas.'));
        void this.health.evaluar();
      } else {
        this.toast.error(this.i18n.t('No se pudo activar. Intenta de nuevo.'));
      }
      return ok;
    } finally {
      this.activando.set(false);
    }
  }

  cerrarHojas(): void {
    this.mostrarDenegado.set(false);
    this.mostrarInstalar.set(false);
  }

  verGuia(): void {
    void this.router.navigate(['/soporte'], { queryParams: { seccion: 'notificaciones' } });
  }

  cerrar(): void {
    this.cerrada.set(true);
  }
}
