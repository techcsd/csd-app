import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * Landing for the password-reset email link. Supabase restores a recovery
 * session from the URL (detectSessionInUrl), then the user sets a new password.
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
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  password = signal('');
  confirm = signal('');
  loading = signal(false);

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
        this.toast.error(this.i18n.t('No se pudo actualizar. Abre el enlace del correo otra vez.'));
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
