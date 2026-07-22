import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';
import { EnProcesoService, EnProcesoItem } from '../../../core/services/en-proceso.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { SyncService } from '../../../core/sync/sync.service';
import { formatFecha, formatFechaMedia } from '../../../core/util/fecha';

/** My bitácoras (server, offline-cached). Tap one to see its details. */
@Component({
  selector: 'app-mis-bitacoras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, ConfirmDialog],
  templateUrl: './mis-partes.html',
  styleUrl: './mis-partes.scss',
})
export class MisPartesPage {
  private bitacora = inject(BitacoraService);
  private enProceso = inject(EnProcesoService);
  private autosave = inject(AutosaveService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private location = inject(Location);

  bitacoras = signal<BitacoraFull[]>([]);
  loading = signal(true);
  error = signal(false); // APP-035 — distinguir error de carga de "sin bitácoras"
  fmtFecha = formatFecha; // U9

  // V1 — "En proceso / Pendientes de envío": borradores (Dexie) + envíos en cola.
  proceso = signal<EnProcesoItem[]>([]);
  confirmar = signal<EnProcesoItem | null>(null);

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
    // V1 — refresca la sección "en proceso" al entrar y tras cada cambio del outbox.
    effect(() => {
      this.sync.changed();
      void this.cargarProceso();
    });
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

  private async cargarProceso(): Promise<void> {
    this.proceso.set(await this.enProceso.list('bitacora'));
  }

  fmtProceso(ms: number): string {
    return formatFechaMedia(new Date(ms).toISOString());
  }

  titulo(b: BitacoraFull): string {
    return b.tipo === 'incidente' ? 'Incidente' : b.tipo === 'visita' ? 'Visita' : 'Bitácora del día';
  }

  open(b: BitacoraFull): void {
    void this.router.navigate(['/bitacora/detalle', b.id]);
  }

  // ── V1 — acciones de "en proceso" ──
  retomar(item: EnProcesoItem): void {
    if (item.kind !== 'borrador') {
      // Un envío en cola no se "retoma": se ve/gestiona en Pendientes de envío.
      void this.router.navigate(['/pendientes']);
      return;
    }
    if (!item.ruta) return;
    const [path] = item.ruta.split('?');
    if (item.resumePorClave) {
      void this.router.navigate([path], { queryParams: { borrador: item.id } });
    } else {
      void this.router.navigateByUrl(item.ruta);
    }
  }

  pedirDescartar(item: EnProcesoItem): void {
    this.confirmar.set(item);
  }

  async descartar(): Promise<void> {
    const item = this.confirmar();
    this.confirmar.set(null);
    if (!item || item.kind !== 'borrador') return;
    await this.autosave.discard(item.id);
    await this.cargarProceso();
  }

  irPendientes(): void {
    void this.router.navigate(['/pendientes']);
  }

  nueva(): void {
    void this.router.navigate(['/bitacora/parte']);
  }

  back(): void {
    this.location.back();
  }
}
