import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { DecimalPipe } from '@angular/common';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { InventarioService, MaterialACargo } from '../../../core/services/inventario.service';

/** BV8 — un grupo de materiales por obra (para la vista "A mi cargo"). */
interface GrupoObra {
  proyecto_id: string;
  proyecto: string;
  items: MaterialACargo[];
}

/**
 * BV8 — "Materiales a mi cargo": lo recibido en las obras del ingeniero/encargado que
 * aún no se devolvió (derivado en el servidor: recibido − devuelto por obra+artículo).
 * Solo lectura, agrupado por obra, con lectura offline (read-through). Detrás de
 * comprobación de capacidad: si el RPC del padre aún no está desplegado, se muestra un
 * estado honesto ("aún no disponible") en vez de romperse.
 */
@Component({
  selector: 'app-a-mi-cargo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, EmptyState, Skeleton, TranslatePipe],
  templateUrl: './a-mi-cargo.html',
  styleUrl: './a-mi-cargo.scss',
})
export class AMiCargoPage {
  private inventario = inject(InventarioService);
  private location = inject(Location);

  loading = signal(true);
  /** null = capacidad ausente o consulta fallida (distinto de "sin materiales"). */
  rows = signal<MaterialACargo[] | null>(null);

  grupos = computed<GrupoObra[]>(() => {
    const list = this.rows() ?? [];
    const byObra = new Map<string, GrupoObra>();
    for (const r of list) {
      const g = byObra.get(r.proyecto_id) ?? { proyecto_id: r.proyecto_id, proyecto: r.proyecto, items: [] };
      g.items.push(r);
      byObra.set(r.proyecto_id, g);
    }
    return [...byObra.values()].sort((a, b) => a.proyecto.localeCompare(b.proyecto));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.inventario.materialesACargo());
    } finally {
      this.loading.set(false);
    }
  }

  recargar(): void {
    void this.load();
  }

  back(): void {
    this.location.back();
  }
}
