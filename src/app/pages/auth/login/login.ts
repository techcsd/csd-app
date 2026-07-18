import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SessionService } from '../../../core/services/session.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';

type Modo = 'correo' | 'conductor';

/** First-time / re-login. Online-only flow (User Flow §2). Dos vías: correo +
 *  contraseña (usuarios del sistema) o cédula + PIN (conductores, P5). */
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

  modo = signal<Modo>('correo');

  // Correo + contraseña
  email = signal('');
  password = signal('');

  // Cédula + PIN (conductor)
  cedula = signal('');
  pin = signal('');

  loading = signal(false);

  setModo(m: Modo): void {
    this.modo.set(m);
  }

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
      await this.afterAuth(user.id);
    } catch {
      this.toast.error('No se pudo iniciar sesión. Revisa tu conexión.');
    } finally {
      this.loading.set(false);
    }
  }

  async submitConductor(): Promise<void> {
    if (this.loading()) return;
    const cedula = this.cedula().trim();
    const pin = this.pin().trim();
    if (!cedula) {
      this.toast.error('Escribe tu cédula.');
      return;
    }
    if (pin.length < 4) {
      this.toast.error('Escribe tu PIN.');
      return;
    }
    this.loading.set(true);
    try {
      const r = await this.auth.signInConductor(cedula, pin);
      if (!r.ok) {
        if (r.status === 429) {
          const mins = Math.max(1, Math.ceil((r.retryInSeconds ?? 900) / 60));
          this.toast.error(r.error ?? `Demasiados intentos. Espera ~${mins} min e intenta de nuevo.`);
        } else if (r.status === 401) {
          this.toast.error('Cédula o PIN incorrectos.');
        } else {
          this.toast.error(r.error ?? 'No se pudo iniciar sesión. Revisa tu conexión.');
        }
        return;
      }
      const user = await this.auth.getUser();
      if (!user) {
        this.toast.error('No se pudo iniciar sesión. Intenta de nuevo.');
        return;
      }
      await this.afterAuth(user.id);
    } catch {
      this.toast.error('No se pudo iniciar sesión. Revisa tu conexión.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Post-login común: valida perfil/módulos y pasa a configurar el PIN local. */
  private async afterAuth(userId: string): Promise<void> {
    await this.ctx.loadProfile(userId);
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
    // Fresh login → set up the local PIN next (desbloqueo local, distinto del PIN de acceso).
    await this.router.navigate(['/auth/pin-setup']);
  }
}
