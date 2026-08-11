import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import {
  AdminService,
  RolAdmin,
  PermisosMap,
  NivelPermiso,
  MODULOS_DISPONIBLES,
  SUBMODULOS,
  ModuloInfo,
} from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

/** AL2 — Administración › Roles y permisos (matriz AG12): módulos + submódulos
 *  granulares (ver/operar). Lectura/escritura directa en `roles` (RLS is_admin). */
@Component({
  selector: 'app-admin-roles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog],
  templateUrl: './roles.html',
  styleUrl: './roles.scss',
})
export class AdminRolesPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly modulos = MODULOS_DISPONIBLES;
  readonly submodulos = SUBMODULOS;

  loading = signal(true);
  roles = signal<RolAdmin[]>([]);

  // Edición
  editando = signal<RolAdmin | 'nuevo' | null>(null);
  nombre = signal('');
  descripcion = signal('');
  selMod = signal<Set<string>>(new Set());
  permisos = signal<PermisosMap>({});
  guardando = signal(false);
  confirmDel = signal<RolAdmin | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.roles.set(await this.admin.getRoles());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar los roles.');
    } finally {
      this.loading.set(false);
    }
  }

  nuevo(): void {
    this.editando.set('nuevo');
    this.nombre.set('');
    this.descripcion.set('');
    this.selMod.set(new Set());
    this.permisos.set({});
  }
  editar(r: RolAdmin): void {
    this.editando.set(r);
    this.nombre.set(r.nombre);
    this.descripcion.set(r.descripcion ?? '');
    this.selMod.set(new Set(r.modulos ?? []));
    this.permisos.set({ ...(r.permisos ?? {}) });
  }
  cerrar(): void {
    this.editando.set(null);
  }

  modLabel(r: RolAdmin): string {
    return (r.modulos ?? []).length ? `${r.modulos.length} módulo(s)` : 'Sin módulos';
  }

  tieneMod(key: string): boolean {
    return this.selMod().has(key);
  }
  toggleMod(key: string): void {
    this.selMod.update((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  subsDe(m: ModuloInfo): { key: string; label: string; enforced?: boolean }[] {
    return this.submodulos[m.key] ?? [];
  }
  nivelDe(subkey: string): '' | NivelPermiso {
    return this.permisos()[subkey] ?? '';
  }
  setNivel(subkey: string, nivel: string): void {
    this.permisos.update((p) => {
      const n = { ...p };
      if (nivel === 'ver' || nivel === 'operar') n[subkey] = nivel;
      else delete n[subkey];
      return n;
    });
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe el nombre del rol.');
      return;
    }
    this.guardando.set(true);
    const ed = this.editando();
    try {
      await this.admin.guardarRol({
        id: ed && ed !== 'nuevo' ? ed.id : undefined,
        nombre: this.nombre(),
        modulos: [...this.selMod()],
        permisos: this.permisos(),
        descripcion: this.descripcion().trim() || null,
      });
      this.toast.success('Rol guardado.');
      this.editando.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el rol.');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(): Promise<void> {
    const r = this.confirmDel();
    this.confirmDel.set(null);
    if (!r) return;
    try {
      await this.admin.eliminarRol(r.id);
      this.toast.success('Rol eliminado.');
      this.editando.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el rol.');
    }
  }

  back(): void {
    this.location.back();
  }
}
