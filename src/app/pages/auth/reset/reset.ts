import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/** Request a password-reset email (link points at the production PWA). */
@Component({
  selector: 'app-reset',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, TranslatePipe],
  templateUrl: './reset.html',
  styleUrl: '../login/login.scss',
})
export class ResetPage {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  email = signal('');
  loading = signal(false);
  sent = signal(false);

  async submit(): Promise<void> {
    if (!this.email() || this.loading()) return;
    this.loading.set(true);
    try {
      const { error } = await this.auth.resetPassword(this.email());
      if (error) {
        this.toast.error(this.i18n.t('No se pudo enviar el enlace. Intenta luego.'));
        return;
      }
      this.sent.set(true);
      this.toast.success(this.i18n.t('Te enviamos un enlace a tu correo.'));
    } finally {
      this.loading.set(false);
    }
  }
}
