import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Landing for the password-reset email link. Supabase restores a recovery
 * session from the URL (detectSessionInUrl), then the user sets a new password.
 */
@Component({
  selector: 'app-set-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './set-password.html',
  styleUrl: '../login/login.scss',
})
export class SetPasswordPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  password = signal('');
  confirm = signal('');
  loading = signal(false);

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (this.password().length < 8) {
      this.toast.error('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (this.password() !== this.confirm()) {
      this.toast.error('Las contraseñas no coinciden.');
      return;
    }
    this.loading.set(true);
    try {
      const { error } = await this.auth.updatePassword(this.password());
      if (error) {
        this.toast.error('No se pudo actualizar. Abre el enlace del correo otra vez.');
        return;
      }
      this.toast.success('Contraseña actualizada. Entra de nuevo.');
      await this.auth.signOut();
      await this.router.navigate(['/auth/login']);
    } finally {
      this.loading.set(false);
    }
  }
}
