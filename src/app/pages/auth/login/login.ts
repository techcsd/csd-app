import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SessionService } from '../../../core/services/session.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatCedula, soloDigitosCedula } from '../../../core/util/cedula';
import { environment } from '../../../../environments/environment';

type Modo = 'correo' | 'conductor';

/** First-time / re-login. Online-only flow (User Flow §2). Dos vías: correo +
 *  contraseña (usuarios del sistema) o cédula + PIN (P5). AX2 — la vía por cédula
 *  es ROL-AGNÓSTICA: sirve a chofer Y capataz; el backend (`conductor-login`)
 *  resuelve el rol por el dominio del email sintético. Sin bifurcar código. */
@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, TranslatePipe],
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
  // AS9 — mostrar/ocultar contraseña.
  verPassword = signal(false);

  // Cédula + PIN (conductor). `cedula` guarda el texto CON máscara (visual);
  // el submit envía solo dígitos (AV9).
  cedula = signal('');
  pin = signal('');

  loading = signal(false);

  // CC2 — el panel "usuarios de prueba" del login se ELIMINÓ (era pre-auth y filtraba
  // la lista de cuentas de dev a cualquiera con el enlace). En dev el login solo muestra
  // el badge DEV (en el shell) y, para correos reales de la lista blanca, "Enviarme un
  // enlace mágico" (el padre gatea con dev_token_hook + SMTP de dev).
  readonly esDev = environment.entorno !== 'prod';
  enviandoEnlace = signal(false);

  setModo(m: Modo): void {
    this.modo.set(m);
  }

  // AV9 — máscara en vivo XXX-XXXXXXX-X (guiones solo visuales).
  onCedulaInput(v: string): void {
    this.cedula.set(formatCedula(v));
  }

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (!this.email() || !this.password()) {
      this.toast.error('Escribe tu correo y contraseña.');
      return;
    }
    this.loading.set(true);
    try {
      const { user, error, timedOut } = await this.auth.signIn(this.email(), this.password());
      if (timedOut) {
        this.toast.withAction(
          'No pudimos verificar tus datos. La conexión tardó demasiado. Intenta de nuevo.',
          { label: 'Reintentar', run: () => void this.submit() },
        );
        return;
      }
      if (error || !user) {
        // CC2 — el candado de dev (dev_token_hook) niega el token con un 403 y un
        // mensaje claro; propágalo tal cual en vez del genérico de credenciales.
        if (error && this.esGateDev(error)) {
          this.toast.error('Este entorno es solo para el equipo de Tecnología.');
        } else {
          this.toast.error('Correo o contraseña incorrectos.');
        }
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
    // El server recibe la cédula SIN guiones (solo dígitos).
    const cedula = soloDigitosCedula(this.cedula());
    const pin = this.pin().trim();
    if (!cedula) {
      this.toast.error('Escribe tu cédula.');
      return;
    }
    // BH4 — el PIN de acceso por cédula es de EXACTAMENTE 6 dígitos (así lo crea el
    // alta en `acceso-cedula`). Validar aquí con mensaje claro; antes aceptaba ≥4 y el
    // servidor lo rechazaba sin explicar por qué.
    if (!/^\d{6}$/.test(pin)) {
      this.toast.error('El PIN es de 6 dígitos.');
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
        } else if (r.networkError) {
          // Red/timeout: nunca dejamos el spinner colgado — mensaje claro + reintento.
          this.toast.withAction(
            r.error ?? 'No pudimos verificar tus datos. Intenta de nuevo.',
            { label: 'Reintentar', run: () => void this.submitConductor() },
          );
        } else {
          this.toast.error(r.error ?? 'No pudimos verificar tus datos. Intenta de nuevo.');
        }
        return;
      }
      if (!r.userId) {
        this.toast.error('No pudimos verificar tus datos. Intenta de nuevo.');
        return;
      }
      await this.afterAuth(r.userId);
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
    // AS8 — un usuario SIN módulos ya NO se bloquea: entra y ve solo los módulos
    // GLOBALES (Notas, Tareas, Mensajes, Dudas, Reportar un problema), cuyos datos
    // ya están scopeados por RLS al propio usuario. El aviso de "habla con
    // administración" pasa a ser informativo (no bloqueante).
    if (this.ctx.modulos().length === 0) {
      this.toast.show(
        'Tu usuario aún no tiene módulos asignados. Puedes usar Notas, Tareas y Mensajes; pide acceso a administración para el resto.',
        'info',
        7000,
      );
    }
    // CC3 — si un admin fijó la contraseña de esta cuenta real, obligar a cambiarla
    // ahora (nadie queda conociendo la contraseña de otro). La pantalla set-password
    // en modo forzado limpia la marca y sigue al PIN sin cerrar sesión.
    if (profile?.debe_cambiar_password) {
      await this.router.navigate(['/auth/set-password'], { queryParams: { forzado: 1 } });
      return;
    }
    // Fresh login → set up the local PIN next (desbloqueo local, distinto del PIN de acceso).
    await this.router.navigate(['/auth/pin-setup']);
  }

  /** CC2 — ¿el error de login es el candado de dev (403 del dev_token_hook)? */
  private esGateDev(error: { status?: number; message?: string }): boolean {
    const msg = (error.message ?? '').toLowerCase();
    return error.status === 403 || msg.includes('solo para el equipo de tecnología');
  }

  /**
   * CC2 — enlace mágico (solo dev): para correos reales de la lista blanca que no
   * tienen contraseña de dev a mano. El padre expone SMTP de dev + dev_token_hook;
   * si no está configurado el redirect, la llamada falla y avisamos suave.
   */
  async enviarEnlaceMagico(): Promise<void> {
    if (this.enviandoEnlace()) return;
    const email = this.email().trim();
    if (!email) {
      this.toast.error('Escribe tu correo primero.');
      return;
    }
    this.enviandoEnlace.set(true);
    try {
      const { error } = await this.auth.enviarEnlaceMagico(email);
      if (error) {
        this.toast.error('No pudimos enviar el enlace. Verifica el correo o usa tu contraseña.');
        return;
      }
      this.toast.show(
        `Te enviamos un enlace a ${email}. Ábrelo en este dispositivo para entrar.`,
        'success',
        7000,
      );
    } catch {
      this.toast.error('No pudimos enviar el enlace. Revisa tu conexión.');
    } finally {
      this.enviandoEnlace.set(false);
    }
  }
}
