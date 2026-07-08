import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SessionService } from '../../../core/services/session.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';

/** First-time / re-login with SGC credentials. Online-only flow (User Flow §2). */
@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private auth = inject(AuthService);
  private session = inject(SessionService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private toast = inject(ToastService);

  email = signal('');
  password = signal('');
  loading = signal(false);

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (!this.email() || !this.password()) {
      this.toast.error('Escribe tu correo y contraseña.');
      return;
    }
    this.loading.set(true);
    try {
      const { user, error } = await this.auth.signIn(this.email(), this.password());
      if (error || !user) {
        this.toast.error('Correo o contraseña incorrectos.');
        return;
      }
      await this.ctx.loadProfile(user.id);
      const profile = this.ctx.profile();
      if (profile && profile.activo === false) {
        await this.session.logout();
        this.toast.error('Tu usuario está desactivado. Habla con administración.');
        return;
      }
      if (this.ctx.modulos().length === 0) {
        await this.session.logout();
        this.toast.error('Tu usuario no tiene módulos de la app. Habla con administración.');
        return;
      }
      // Fresh password login → set up the local PIN next.
      await this.router.navigate(['/auth/pin-setup']);
    } catch {
      this.toast.error('No se pudo iniciar sesión. Revisa tu conexión.');
    } finally {
      this.loading.set(false);
    }
  }
}
