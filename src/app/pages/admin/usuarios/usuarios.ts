import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AdminService, UsuarioAdmin, RolAdmin } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

/** AL2 — Administración › Usuarios: alta (invitación), roles, activar/desactivar,
 *  reset de contraseña. Escrituras vía edge functions + RPCs (gate is_admin). */
@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss',
})
export class AdminUsuariosPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

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
  back(): void {
    this.location.back();
  }
}
