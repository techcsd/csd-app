import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { Bodega, Existencia } from '../../../core/models/inventario.model';

/** Guided physical count: adjust each article's stock to the counted value. */
@Component({
  selector: 'app-conteo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BigConfirm, SelectList],
  templateUrl: './conteo.html',
  styleUrl: './conteo.scss',
})
export class ConteoPage {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  existencias = signal<Existencia[]>([]);
  contado = signal<Record<string, number>>({});
  motivo = signal('');
  loading = signal(false);
  submitting = signal(false);
  done = signal(false);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const b = await this.inventario.getBodegas();
    this.bodegas.set(b);
    if (b.length === 1) await this.onBodega(b[0].id);
  }

  async onBodega(id: string): Promise<void> {
    this.bodegaId.set(id);
    if (!id) return;
    this.loading.set(true);
    try {
      const ex = await this.inventario.getExistencias(id);
      this.existencias.set(ex);
      const init: Record<string, number> = {};
      for (const e of ex) init[e.articulo_id] = e.cantidad;
      this.contado.set(init);
    } finally {
      this.loading.set(false);
    }
  }

  setContado(articuloId: string, v: number): void {
    this.contado.update((m) => ({ ...m, [articuloId]: Math.max(0, v ?? 0) }));
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige la bodega.');
      return;
    }
    // Only send items whose count changed.
    const items = this.existencias()
      .map((e) => ({ articulo_id: e.articulo_id, cantidad_contada: this.contado()[e.articulo_id] ?? e.cantidad }))
      .filter((it, i) => it.cantidad_contada !== this.existencias()[i].cantidad);
    if (!items.length) {
      this.toast.error('No cambiaste ninguna cantidad.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.inventario.enqueueConteo({
        bodegaId: this.bodegaId(),
        motivo: this.motivo().trim() || null,
        items,
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/inventario'], { replaceUrl: true });
  }
}
