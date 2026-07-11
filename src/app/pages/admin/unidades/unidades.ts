import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, Unidad } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

/** Manage unidades de medida (same catalog SGC uses). */
@Component({
  selector: 'app-admin-unidades',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './unidades.html',
  styleUrl: './unidades.scss',
})
export class AdminUnidadesPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

  unidades = signal<Unidad[]>([]);
  loading = signal(true);
  nuevo = signal('');
  saving = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.unidades.set(await this.admin.getUnidades());
    } finally {
      this.loading.set(false);
    }
  }

  async agregar(): Promise<void> {
    const nombre = this.nuevo().trim();
    if (!nombre || this.saving()) return;
    this.saving.set(true);
    try {
      const u = await this.admin.crearUnidad(nombre);
      this.unidades.update((l) => [...l, u].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      this.nuevo.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Error.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(u: Unidad): Promise<void> {
    const next = !u.activo;
    this.unidades.update((l) => l.map((x) => (x.id === u.id ? { ...x, activo: next } : x)));
    try {
      await this.admin.toggleUnidad(u.id, next);
    } catch {
      this.unidades.update((l) => l.map((x) => (x.id === u.id ? { ...x, activo: !next } : x)));
    }
  }

  back(): void {
    this.location.back();
  }
}
