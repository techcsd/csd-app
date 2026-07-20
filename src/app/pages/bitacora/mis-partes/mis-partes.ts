import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';
import { formatFecha } from '../../../core/util/fecha';

/** My bitácoras (server, offline-cached). Tap one to see its details. */
@Component({
  selector: 'app-mis-bitacoras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './mis-partes.html',
  styleUrl: './mis-partes.scss',
})
export class MisPartesPage {
  private bitacora = inject(BitacoraService);
  private router = inject(Router);
  private location = inject(Location);

  bitacoras = signal<BitacoraFull[]>([]);
  loading = signal(true);
  error = signal(false); // APP-035 — distinguir error de carga de "sin bitácoras"
  fmtFecha = formatFecha; // U9

  // Q9 — segmentar por obra: filtro + conteo por proyecto.
  filtroObra = signal(''); // '' = todas
  obras = computed(() => {
    const m = new Map<string, number>();
    for (const b of this.bitacoras()) {
      const nombre = b.proyecto?.nombre ?? '—';
      m.set(nombre, (m.get(nombre) ?? 0) + 1);
    }
    return [...m.entries()].map(([nombre, count]) => ({ nombre, count })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });
  filtradas = computed(() => {
    const f = this.filtroObra();
    if (!f) return this.bitacoras();
    return this.bitacoras().filter((b) => (b.proyecto?.nombre ?? '—') === f);
  });

  constructor() {
    void this.load();
  }

  setFiltroObra(nombre: string): void {
    this.filtroObra.update((cur) => (cur === nombre ? '' : nombre));
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.bitacoras.set(await this.bitacora.misBitacoras());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  titulo(b: BitacoraFull): string {
    return b.tipo === 'incidente' ? 'Incidente' : b.tipo === 'visita' ? 'Visita' : 'Bitácora del día';
  }

  open(b: BitacoraFull): void {
    void this.router.navigate(['/bitacora/detalle', b.id]);
  }

  nueva(): void {
    void this.router.navigate(['/bitacora/parte']);
  }

  back(): void {
    this.location.back();
  }
}
