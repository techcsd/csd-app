import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { Conduce } from '../../../core/models/transporte.model';

/** Bodeguero confirms receipt of a dispatched conduce (offline-first). */
@Component({
  selector: 'app-recibir-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, SyncBar],
  templateUrl: './recibir.html',
  styleUrl: './recibir.scss',
})
export class RecibirConducePage {
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private location = inject(Location);

  conduces = signal<Conduce[]>([]);
  loading = signal(true);
  expandedId = signal<string | null>(null);
  cantidades = signal<Record<string, number>>({});
  foto = signal<CapturedPhoto | null>(null);
  capturing = signal(false);
  submitting = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.conduces.set(await this.inventario.conducesPorRecibir());
    } finally {
      this.loading.set(false);
    }
  }

  toggle(c: Conduce): void {
    if (this.expandedId() === c.id) {
      this.expandedId.set(null);
      return;
    }
    const init: Record<string, number> = {};
    for (const it of c.items) init[it.detalle_id] = it.cantidad;
    this.cantidades.set(init);
    this.foto.set(null);
    this.expandedId.set(c.id);
  }

  setCantidad(detalleId: string, v: number): void {
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.max(0, v || 0) }));
  }

  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const p = await this.camera.takePhoto();
      if (p) this.foto.set(p);
    } finally {
      this.capturing.set(false);
    }
  }

  async confirm(c: Conduce): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.inventario.enqueueRecepcion({
        salidaId: c.id,
        items: c.items.map((it) => ({
          detalle_id: it.detalle_id,
          cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
        })),
        notas: null,
        foto: this.foto()?.blob ?? null,
      });
      this.conduces.update((list) => list.filter((x) => x.id !== c.id));
      this.expandedId.set(null);
      this.toast.success('Recepción guardada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
