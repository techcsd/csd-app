import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { OrdenTrabajoResumen } from '../../../core/models/bitacora.model';
import { formatFecha } from '../../../core/util/fecha';

/**
 * BW1 — "Mis órdenes de trabajo" (nota #65). Lista offline read-through de las
 * órdenes que el usuario puede ver: las suyas, o las de sus obras si es elevado
 * (`p_solo_mias = !elevado`). Buscador por nº/obra/responsable, filtro por obra,
 * chip de estado. Tap → ficha (ver / compartir / enviar).
 */
@Component({
  selector: 'app-mis-ordenes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe],
  templateUrl: './mis-ordenes.html',
  styleUrl: './mis-ordenes.scss',
})
export class MisOrdenesPage {
  private bitacora = inject(BitacoraService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  fmtFecha = formatFecha;

  ordenes = signal<OrdenTrabajoResumen[]>([]);
  loading = signal(true);
  error = signal(false); // BL2 — distinguir "falló" de "sin órdenes"
  private soloMias = true; // se recalcula según rol (elevado ve las de sus obras)

  term = signal('');
  filtroObra = signal(''); // '' = todas

  obras = computed(() => {
    const m = new Map<string, number>();
    for (const o of this.ordenes()) {
      const nombre = o.proyecto ?? '—';
      m.set(nombre, (m.get(nombre) ?? 0) + 1);
    }
    return [...m.entries()].map(([nombre, count]) => ({ nombre, count })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  filtradas = computed(() => {
    const q = this.term().trim().toLowerCase();
    const obra = this.filtroObra();
    return this.ordenes().filter((o) => {
      if (obra && (o.proyecto ?? '—') !== obra) return false;
      if (!q) return true;
      return (
        o.codigo.toLowerCase().includes(q) ||
        (o.proyecto ?? '').toLowerCase().includes(q) ||
        (o.responsable ?? '').toLowerCase().includes(q) ||
        (o.descripcion ?? '').toLowerCase().includes(q)
      );
    });
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      this.soloMias = !(await this.bitacora.puedeVerOtrasBitacoras());
    } catch {
      this.soloMias = true;
    }
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const res = await this.bitacora.listarOrdenesTrabajo(this.soloMias);
      this.ordenes.set(res.data);
      // Falló y ni siquiera hay caché → estado de error con reintento (no falso vacío).
      this.error.set(res.failed && !res.fromCache);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  setFiltroObra(nombre: string): void {
    this.filtroObra.update((cur) => (cur === nombre ? '' : nombre));
  }

  estadoLabel(e: string): string {
    return e === 'firmada' ? this.i18n.t('Firmada') : e === 'emitida' ? this.i18n.t('Emitida') : this.i18n.t('Borrador');
  }

  open(o: OrdenTrabajoResumen): void {
    void this.router.navigate(['/bitacora/orden-trabajo', o.bitacora_id]);
  }

  nueva(): void {
    void this.router.navigate(['/bitacora/orden-trabajo']);
  }

  back(): void {
    this.location.back();
  }
}
