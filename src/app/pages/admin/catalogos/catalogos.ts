import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, BCatalogo } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

type Tipo = 'estructura' | 'actividad' | 'restriccion';

/** Manage bitácora catalogs (estructuras / actividades / restricciones). */
@Component({
  selector: 'app-admin-catalogos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './catalogos.html',
  styleUrl: '../unidades/unidades.scss',
})
export class AdminCatalogosPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly grupos: { tipo: Tipo; label: string }[] = [
    { tipo: 'estructura', label: 'Estructuras' },
    { tipo: 'actividad', label: 'Actividades' },
    { tipo: 'restriccion', label: 'Restricciones' },
  ];

  catalogos = signal<BCatalogo[]>([]);
  loading = signal(true);
  nuevoTipo = signal<Tipo>('estructura');
  nuevoValor = signal('');
  saving = signal(false);

  porTipo = computed(() => {
    const map: Record<Tipo, BCatalogo[]> = { estructura: [], actividad: [], restriccion: [] };
    for (const c of this.catalogos()) map[c.tipo].push(c);
    return map;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.catalogos.set(await this.admin.getBCatalogos());
    } finally {
      this.loading.set(false);
    }
  }

  async agregar(): Promise<void> {
    const valor = this.nuevoValor().trim();
    if (!valor || this.saving()) return;
    this.saving.set(true);
    try {
      const c = await this.admin.crearBCatalogo(this.nuevoTipo(), valor);
      this.catalogos.update((l) => [...l, c]);
      this.nuevoValor.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Error.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(c: BCatalogo): Promise<void> {
    const next = !c.activo;
    this.catalogos.update((l) => l.map((x) => (x.id === c.id ? { ...x, activo: next } : x)));
    try {
      await this.admin.toggleBCatalogo(c.id, next);
    } catch {
      this.catalogos.update((l) => l.map((x) => (x.id === c.id ? { ...x, activo: !next } : x)));
    }
  }

  back(): void {
    this.location.back();
  }
}
