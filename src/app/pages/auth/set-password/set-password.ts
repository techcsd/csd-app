import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * Landing for the password-reset email link. Supabase restores a recovery
 * session from the URL (detectSessionInUrl), then the user sets a new password.
 *
 * CC3 — también sirve el modo "forzado" (`?forzado=1`): un admin fijó la contraseña
 * de la cuenta y el usuario ya entró; aquí la cambia, limpiamos la marca y seguimos
 * al PIN SIN cerrar sesión (a diferencia del flujo de recuperación por correo).
 */
@Component({
  selector: 'app-set-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './set-password.html',
  styleUrl: '../login/login.scss',
})
export class SetPasswordPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  password = signal('');
  confirm = signal('');
  loading = signal(false);
  /** CC3 — cambio obligatorio tras que un admin fijara la contraseña. */
  readonly forzado = this.route.snapshot.queryParamMap.get('forzado') === '1';

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (this.password().length < 8) {
      this.toast.error(this.i18n.t('La contraseña debe tener al menos 8 caracteres.'));
      return;
    }
    if (this.password() !== this.confirm()) {
      this.toast.error(this.i18n.t('Las contraseñas no coinciden.'));
      return;
    }
    this.loading.set(true);
    try {
      const { error } = await this.auth.updatePassword(this.password());
      if (error) {
        this.toast.error(
          this.forzado
            ? this.i18n.t('No se pudo actualizar. Intenta de nuevo.')
            : this.i18n.t('No se pudo actualizar. Abre el enlace del correo otra vez.'),
        );
        return;
      }
      if (this.forzado) {
        // CC3 — sesión ya viva: limpiar la marca y seguir al PIN sin re-login.
        await this.auth.limpiarDebeCambiarPassword();
        this.toast.success(this.i18n.t('Contraseña actualizada.'));
        await this.router.navigate(['/auth/pin-setup']);
        return;
      }
      this.toast.success(this.i18n.t('Contraseña actualizada. Entra de nuevo.'));
      await this.auth.signOut();
      await this.router.navigate(['/auth/login']);
    } finally {
      this.loading.set(false);
    }
  }
}
