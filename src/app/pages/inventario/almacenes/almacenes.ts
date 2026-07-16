import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { BodegaAdmin } from '../../../core/models/inventario.model';
import { homologarTexto } from '../../../core/util/texto';

/**
 * Gestión de almacenes desde la app (R12) — paridad con la web. CRUD directo
 * (RLS exige módulo inventario, igual que la web). Es pantalla de configuración,
 * por eso requiere conexión. La homologación del nombre la garantiza el trigger
 * de BD; aquí se previsualiza en el form (R18).
 */
@Component({
  selector: 'app-almacenes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog],
  templateUrl: './almacenes.html',
  styleUrl: './almacenes.scss',
})
export class AlmacenesPage {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  loading = signal(true);
  bodegas = signal<BodegaAdmin[]>([]);

  // Form state.
  formOpen = signal(false);
  editId = signal<string | null>(null);
  nombre = signal('');
  ubicacion = signal('');
  descripcion = signal('');
  saving = signal(false);

  // Deactivate confirm.
  confirmId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.bodegas.set(await this.inventario.getBodegasAdmin());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los almacenes.');
    } finally {
      this.loading.set(false);
    }
  }

  nuevo(): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.editId.set(null);
    this.nombre.set('');
    this.ubicacion.set('');
    this.descripcion.set('');
    this.formOpen.set(true);
  }

  editar(b: BodegaAdmin): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.editId.set(b.id);
    this.nombre.set(b.nombre);
    this.ubicacion.set(b.ubicacion ?? '');
    this.descripcion.set(b.descripcion ?? '');
    this.formOpen.set(true);
  }

  cancelar(): void {
    this.formOpen.set(false);
  }

  /** Live preview of the server-side homologation (first letter uppercase). */
  onNombre(v: string): void {
    this.nombre.set(v);
  }

  get nombrePreview(): string {
    return homologarTexto(this.nombre());
  }

  async guardar(): Promise<void> {
    if (this.saving()) return;
    const nombre = homologarTexto(this.nombre());
    if (!nombre) {
      this.toast.error('Escribe el nombre del almacén.');
      return;
    }
    this.saving.set(true);
    try {
      const payload = {
        nombre,
        ubicacion: this.ubicacion().trim() || null,
        descripcion: this.descripcion().trim() || null,
      };
      if (this.editId()) {
        await this.inventario.actualizarBodega(this.editId()!, payload);
        this.toast.success('Almacén actualizado.');
      } else {
        await this.inventario.crearBodega(payload);
        this.toast.success('Almacén creado.');
      }
      this.formOpen.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  pedirDesactivar(b: BodegaAdmin): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.confirmId.set(b.id);
  }

  async toggleActivo(b: BodegaAdmin): Promise<void> {
    this.confirmId.set(null);
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    try {
      await this.inventario.setBodegaActivo(b.id, !b.activo);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }

  cancelarConfirm(): void {
    this.confirmId.set(null);
  }

  back(): void {
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
