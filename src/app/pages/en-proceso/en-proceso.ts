import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { BorradorService } from '../../core/services/borrador.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { SyncService } from '../../core/sync/sync.service';
import {
  EnProcesoService,
  EnProcesoItem,
  EnProcesoModulo,
} from '../../core/services/en-proceso.service';
import { formatFechaCortaHora } from '../../core/util/fecha';

/**
 * Y10 — "Documentación en proceso" coherente: dos grupos etiquetados —
 * "A medio llenar" (borradores Dexie, con Retomar/Descartar) y "Pendientes de
 * envío" (items del outbox con su estado; las acciones de reintentar/descartar
 * viven en /pendientes, que reutilizamos). El contenido = exactamente lo que
 * cuentan los badges (EnProcesoService), así el badge nunca miente.
 */
@Component({
  selector: 'app-en-proceso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton, ConfirmDialog],
  templateUrl: './en-proceso.html',
  styleUrl: './en-proceso.scss',
})
export class EnProcesoPage {
  private enProceso = inject(EnProcesoService);
  private borrador = inject(BorradorService);
  private autosave = inject(AutosaveService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  /** Filtro opcional por módulo (?modulo=flota|bitacora) para casar con el badge del cuadro. */
  private modulo: EnProcesoModulo | null = null;

  loading = signal(true);
  items = signal<EnProcesoItem[]>([]);
  confirmar = signal<EnProcesoItem | null>(null);

  borradores = computed(() => this.items().filter((i) => i.kind === 'borrador'));
  envios = computed(() => this.items().filter((i) => i.kind === 'envio'));

  constructor() {
    const m = this.route.snapshot.queryParamMap.get('modulo');
    this.modulo = m === 'flota' || m === 'bitacora' ? m : null;
    // Refresca al entrar y con cada cambio del outbox (drena/encola/error) para
    // que la vista siga cuadrando con el badge en vivo.
    effect(() => {
      this.sync.changed();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // S5 — migra el borrador legacy 'parte_diario' a clave por instancia.
      await this.borrador.migrateLegacyParte();
      const list = this.modulo
        ? await this.enProceso.list(this.modulo)
        : await this.enProceso.listAll();
      this.items.set(list);
    } finally {
      this.loading.set(false);
    }
  }

  /** Y1 — fecha + hora del último guardado ("23/07 · 6:41 pm"). */
  fmt(ms: number): string {
    return formatFechaCortaHora(ms);
  }

  retomar(b: EnProcesoItem): void {
    if (!b.ruta) {
      this.location.back();
      return;
    }
    const [path] = b.ruta.split('?');
    if (b.resumePorClave) {
      void this.router.navigate([path], { queryParams: { borrador: b.id } });
    } else {
      void this.router.navigateByUrl(b.ruta);
    }
  }

  /** Los envíos (outbox) se reintentan/descartan en la pantalla de Pendientes. */
  verPendientes(): void {
    void this.router.navigate(['/pendientes']);
  }

  pedirDescartar(b: EnProcesoItem): void {
    this.confirmar.set(b);
  }

  async descartar(): Promise<void> {
    const b = this.confirmar();
    this.confirmar.set(null);
    if (!b) return;
    await this.autosave.discard(b.id); // b.id = clave del borrador
    this.items.update((list) => list.filter((x) => !(x.kind === 'borrador' && x.id === b.id)));
  }

  back(): void {
    this.location.back();
  }
}
