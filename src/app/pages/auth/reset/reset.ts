import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

/** Request a password-reset email (link points at the production PWA). */
@Component({
  selector: 'app-reset',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './reset.html',
  styleUrl: '../login/login.scss',
})
export class ResetPage {
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  email = signal('');
  loading = signal(false);
  sent = signal(false);

  async submit(): Promise<void> {
    if (!this.email() || this.loading()) return;
    this.loading.set(true);
    try {
      const { error } = await this.auth.resetPassword(this.email());
      if (error) {
        this.toast.error('No se pudo enviar el enlace. Intenta luego.');
        return;
      }
      this.sent.set(true);
      this.toast.success('Te enviamos un enlace a tu correo.');
    } finally {
      this.loading.set(false);
    }
  }
}
