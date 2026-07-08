import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { InventarioService } from '../../../core/services/inventario.service';
import { Bodega, Existencia } from '../../../core/models/inventario.model';

/** Consult stock for a bodega, with tolerant search. */
@Component({
  selector: 'app-existencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectList],
  templateUrl: './existencias.html',
  styleUrl: './existencias.scss',
})
export class ExistenciasPage {
  private inventario = inject(InventarioService);
  private location = inject(Location);

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  existencias = signal<Existencia[]>([]);
  query = signal('');
  loading = signal(false);

  filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.existencias();
    return this.existencias().filter(
      (e) => e.nombre.toLowerCase().includes(q) || e.codigo.toLowerCase().includes(q),
    );
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const b = await this.inventario.getBodegas();
    this.bodegas.set(b);
    if (b.length === 1) {
      this.bodegaId.set(b[0].id);
      await this.loadStock();
    }
  }

  async onBodega(id: string): Promise<void> {
    this.bodegaId.set(id);
    await this.loadStock();
  }

  private async loadStock(): Promise<void> {
    if (!this.bodegaId()) return;
    this.loading.set(true);
    try {
      this.existencias.set(await this.inventario.getExistencias(this.bodegaId()));
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
