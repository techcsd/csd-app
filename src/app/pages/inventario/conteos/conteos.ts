import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ConteoHistorial, ConteoItemHist } from '../../../core/models/inventario.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * Y10 — "Conteo y ajustes" en la app (parity con la web). Historial de conteos/
 * ajustes de inventario (RLS `conteos_select`: admin/módulo inventario), con
 * detalle expandible (antes → contado por artículo). El alta reutiliza el flujo
 * offline-first existente "Conteo rápido" (outbox → registrar_conteo_app).
 */
@Component({
  selector: 'app-conteos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './conteos.html',
  styleUrl: './conteos.scss',
})
export class ConteosPage {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  conteos = signal<ConteoHistorial[]>([]);
  loading = signal(true);
  private expandido = signal<Set<string>>(new Set());

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.conteos.set(await this.inventario.getConteos());
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  abierto(id: string): boolean {
    return this.expandido().has(id);
  }
  toggle(id: string): void {
    this.expandido.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  tipoLabel(t: string | null): string {
    return t === 'chequeo_semanal' ? 'Chequeo semanal' : 'Ajuste';
  }

  /** Diferencia por línea (contada - antes), normalizando numéricos de PostgREST. */
  diff(it: ConteoItemHist): number {
    return Number(it.cantidad_contada) - Number(it.cantidad_antes);
  }

  /** Nº de líneas con diferencia (para el resumen de la tarjeta). */
  diferencias(c: ConteoHistorial): number {
    return (c.items ?? []).filter((it) => this.diff(it) !== 0).length;
  }

  fmtFecha(iso: string | null): string {
    return iso ? formatFechaMedia(iso) : '—';
  }

  nuevo(): void {
    void this.router.navigate(['/inventario/conteo']);
  }

  back(): void {
    this.location.back();
  }
}
