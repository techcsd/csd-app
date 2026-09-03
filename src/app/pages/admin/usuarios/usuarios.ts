import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { EmailDisplayPipe } from '../../../shared/ui/pipes/email-display.pipe';
import { Router } from '@angular/router';
import { AdminService, UsuarioAdmin, RolAdmin } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { ImpersonationService } from '../../../core/services/impersonation.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { SyncService } from '../../../core/sync/sync.service';

/** AL2 — Administración › Usuarios: alta (invitación), roles, activar/desactivar,
 *  reset de contraseña. Escrituras vía edge functions + RPCs (gate is_admin). */
@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog, EmailDisplayPipe],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss',
})
export class AdminUsuariosPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private imp = inject(ImpersonationService);
  private ctx = inject(UserContextService);
  private sync = inject(SyncService);
  private router = inject(Router);

  entrandoComoId = signal<string>('');

  loading = signal(true);
  usuarios = signal<UsuarioAdmin[]>([]);
  roles = signal<RolAdmin[]>([]);
  busqueda = signal('');

  expandidoId = signal('');
  editNombre = signal('');
  editRoles = signal<Set<number>>(new Set());
  guardando = signal(false);

  // Alta
  creando = signal(false);
  nuevoEmail = signal('');
  nuevoNombre = signal('');
  nuevoRol = signal<number | null>(null);
  enviandoAlta = signal(false);

  confirm = signal<{ msg: string; run: () => void } | null>(null);

  filtrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    if (!q) return this.usuarios();
    return this.usuarios().filter((u) => `${u.nombre} ${u.email ?? ''}`.toLowerCase().includes(q));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [us, rs] = await Promise.all([this.admin.getUsuarios(), this.admin.getRoles()]);
      this.usuarios.set(us);
      this.roles.set(rs);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar los usuarios.');
    } finally {
      this.loading.set(false);
    }
  }

  abrir(u: UsuarioAdmin): void {
    if (this.expandidoId() === u.id) {
      this.expandidoId.set('');
      return;
    }
    this.expandidoId.set(u.id);
    this.editNombre.set(u.nombre);
    this.editRoles.set(new Set((u.roles ?? []).map((r) => r.rol.id)));
  }

  toggleRol(id: number): void {
    this.editRoles.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  tieneRol(id: number): boolean {
    return this.editRoles().has(id);
  }
  rolesLabel(u: UsuarioAdmin): string {
    return (u.roles ?? []).map((r) => r.rol.nombre).join(', ') || 'Sin rol';
  }

  async guardar(u: UsuarioAdmin): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      if (this.editNombre().trim() && this.editNombre().trim() !== u.nombre) {
        await this.admin.actualizarNombre(u.id, this.editNombre());
      }
      await this.admin.asignarRoles(u.id, [...this.editRoles()]);
      this.toast.success('Usuario actualizado.');
      this.expandidoId.set('');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  pedirToggleActivo(u: UsuarioAdmin): void {
    const activar = !u.activo;
    this.confirm.set({
      msg: activar ? `¿Reactivar a ${u.nombre}?` : `¿Desactivar a ${u.nombre}? No podrá iniciar sesión.`,
      run: () => void this.doToggleActivo(u, activar),
    });
  }
  private async doToggleActivo(u: UsuarioAdmin, activo: boolean): Promise<void> {
    try {
      await this.admin.toggleActivo(u.id, activo);
      this.toast.success(activo ? 'Usuario reactivado.' : 'Usuario desactivado.');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  pedirReset(u: UsuarioAdmin): void {
    this.confirm.set({
      msg: `¿Enviar enlace para restablecer la contraseña de ${u.nombre}?`,
      run: () => void this.doReset(u),
    });
  }
  private async doReset(u: UsuarioAdmin): Promise<void> {
    try {
      await this.admin.resetPassword(u.id);
      this.toast.success('Enlace de restablecimiento enviado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el enlace.');
    }
  }

  /** BI5 — ¿entra por cédula (email sintético, sin buzón real)? Entonces el botón
   *  es "Fijar PIN", no "Restablecer contraseña" (que mandaría un correo inexistente). */
  esSintetico(u: UsuarioAdmin): boolean {
    return /@(conductores|personal|test)\.constructorasd\.local$/i.test(u.email ?? '');
  }

  private pinTrivial(pin: string): boolean {
    if (!/^\d{6}$/.test(pin)) return true;
    if (/^(\d)\1{5}$/.test(pin)) return true;
    if (['123456', '654321', '123123', '121212', '112233'].includes(pin)) return true;
    let asc = true, desc = true;
    for (let i = 1; i < 6; i++) { const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1); if (d !== 1) asc = false; if (d !== -1) desc = false; }
    return asc || desc;
  }
  private genPin(): string {
    for (let i = 0; i < 50; i++) {
      const a = new Uint32Array(6); crypto.getRandomValues(a);
      const p = Array.from(a, (n) => (n % 10).toString()).join('');
      if (!this.pinTrivial(p)) return p;
    }
    return '481973';
  }

  /** BI5 — fija el PIN de un usuario de cédula (paridad con la web). */
  async pedirFijarPin(u: UsuarioAdmin): Promise<void> {
    const sugerido = this.genPin();
    const pin = (window.prompt(`Fijar PIN de 6 dígitos para ${u.nombre} (entra con su cédula + PIN). Sugerido:`, sugerido) ?? '').trim();
    if (!pin) return;
    if (this.pinTrivial(pin)) { this.toast.error('Ese PIN es demasiado fácil (repetido/secuencia). Elige otro.'); return; }
    try {
      await this.admin.fijarPinUsuario(u.id, pin);
      this.toast.success(`PIN fijado. Entrégaselo a ${u.nombre}: ${pin}`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo fijar el PIN.');
    }
  }

  async reenviar(u: UsuarioAdmin): Promise<void> {
    try {
      await this.admin.reenviarInvitacion(u.id);
      this.toast.success('Invitación reenviada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo reenviar.');
    }
  }

  async crear(): Promise<void> {
    if (this.enviandoAlta()) return;
    if (!this.nuevoEmail().trim() || !this.nuevoNombre().trim()) {
      this.toast.error('Escribe el correo y el nombre.');
      return;
    }
    this.enviandoAlta.set(true);
    try {
      await this.admin.crearUsuario(this.nuevoEmail(), this.nuevoNombre(), this.nuevoRol());
      this.toast.success('Usuario invitado por correo.');
      this.creando.set(false);
      this.nuevoEmail.set('');
      this.nuevoNombre.set('');
      this.nuevoRol.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el usuario.');
    } finally {
      this.enviandoAlta.set(false);
    }
  }

  runConfirm(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.run();
  }

  // ── BB "Entrar como" — ver la app como este usuario (reproducir su problema) ──
  /** No se puede entrar como uno mismo ni como otro admin (el server también lo bloquea). */
  esSelf(u: UsuarioAdmin): boolean {
    return u.id === this.ctx.profile()?.id;
  }
  esAdminUsuario(u: UsuarioAdmin): boolean {
    return (u.roles ?? []).some((r) => r.rol.codigo === 'admin');
  }
  puedeEntrarComo(u: UsuarioAdmin): boolean {
    return u.activo && !u.pendiente && !this.esSelf(u) && !this.esAdminUsuario(u);
  }

  pedirEntrarComo(u: UsuarioAdmin): void {
    if (!this.puedeEntrarComo(u) || this.entrandoComoId()) return;
    this.confirm.set({
      msg: `¿Entrar como "${u.nombre}"? Verás la app como este usuario. Sal cuando termines con el botón "Salir" del banner superior.`,
      run: () => void this.doEntrarComo(u),
    });
  }
  private async doEntrarComo(u: UsuarioAdmin): Promise<void> {
    // No arrastrar envíos del admin: se subirían como el otro usuario.
    if (this.sync.pendingCount() > 0) {
      this.toast.error('Tienes envíos pendientes. Espera a que sincronicen antes de entrar como otro usuario.');
      return;
    }
    this.entrandoComoId.set(u.id);
    try {
      const r = await this.imp.entrarComo(u.id, u.nombre);
      if (!r.ok) {
        this.toast.error(r.error ?? 'No se pudo entrar como este usuario.');
        return;
      }
      await this.router.navigate(['/home']);
    } finally {
      this.entrandoComoId.set('');
    }
  }

  back(): void {
    this.location.back();
  }
}
