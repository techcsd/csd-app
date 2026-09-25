import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';
import { EnProcesoService, EnProcesoItem } from '../../../core/services/en-proceso.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { SyncService } from '../../../core/sync/sync.service';
import { formatFecha, formatFechaCortaHora, bitacoraRetrofechada } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/** My bitácoras (server, offline-cached). Tap one to see its details. */
@Component({
  selector: 'app-mis-bitacoras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog, TranslatePipe],
  templateUrl: './mis-partes.html',
  styleUrl: './mis-partes.scss',
})
export class MisPartesPage {
  private bitacora = inject(BitacoraService);
  private enProceso = inject(EnProcesoService);
  private autosave = inject(AutosaveService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private i18n = inject(I18nService);

  bitacoras = signal<BitacoraFull[]>([]);
  loading = signal(true);
  error = signal(false); // APP-035 — distinguir error de carga de "sin bitácoras"
  fmtFecha = formatFecha; // U9
  fmtHora = formatFechaCortaHora; // AW2 — fecha · hora

  // AW5 — vista: "Mis bitácoras" (propias) vs "Todas" (solo roles con permiso).
  vista = signal<'mias' | 'todas'>('mias');
  puedeVerTodas = signal(false);

  // V1 — "En proceso / Pendientes de envío": borradores (Dexie) + envíos en cola.
  proceso = signal<EnProcesoItem[]>([]);
  confirmar = signal<EnProcesoItem | null>(null);

  // Q9 — segmentar por obra: filtro + conteo por proyecto.
  filtroObra = signal(''); // '' = todas
  // BY4 — en la vista "Todas": filtrar por fecha e ingeniero (además de la obra).
  filtroFecha = signal(''); // '' = todas (YYYY-MM-DD)
  filtroIngeniero = signal(''); // '' = todos (autor_nombre)
  obras = computed(() => {
    const m = new Map<string, number>();
    for (const b of this.bitacoras()) {
      const nombre = b.proyecto?.nombre ?? '—';
      m.set(nombre, (m.get(nombre) ?? 0) + 1);
    }
    return [...m.entries()].map(([nombre, count]) => ({ nombre, count })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });
  /** BY4 — ingenieros presentes en la lista (para el filtro de la vista "Todas"). */
  ingenieros = computed(() => {
    const s = new Set<string>();
    for (const b of this.bitacoras()) if (b.autor_nombre) s.add(b.autor_nombre);
    return [...s].sort((a, b) => a.localeCompare(b));
  });
  filtradas = computed(() => {
    const fObra = this.filtroObra();
    const fFecha = this.filtroFecha();
    const fIng = this.filtroIngeniero();
    return this.bitacoras().filter(
      (b) =>
        (!fObra || (b.proyecto?.nombre ?? '—') === fObra) &&
        (!fFecha || b.fecha === fFecha) &&
        (!fIng || (b.autor_nombre ?? '') === fIng),
    );
  });

  constructor() {
    // BY4 — se puede llegar con ?vista=todas (tile "Bitácoras de las obras").
    const wantsTodas = this.route.snapshot.queryParamMap.get('vista') === 'todas';
    if (wantsTodas) this.vista.set('todas');
    void this.load();
    // AW5 — ¿puede ver bitácoras de otros? (conmuta el tab "Todas").
    void this.bitacora.puedeVerOtrasBitacoras().then((p) => {
      this.puedeVerTodas.set(p);
      // Pidió "todas" sin permiso → vuelve a "mias" (y recarga las propias).
      if (wantsTodas && !p) {
        this.vista.set('mias');
        void this.load();
      }
    });
    // V1 — refresca la sección "en proceso" al entrar y tras cada cambio del outbox.
    effect(() => {
      this.sync.changed();
      void this.cargarProceso();
    });
  }

  setFiltroObra(nombre: string): void {
    this.filtroObra.update((cur) => (cur === nombre ? '' : nombre));
  }

  /** AW5 — cambia entre "Mis bitácoras" y "Todas". */
  setVista(v: 'mias' | 'todas'): void {
    if (this.vista() === v) return;
    this.vista.set(v);
    this.filtroObra.set('');
    this.filtroFecha.set('');
    this.filtroIngeniero.set('');
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const data =
        this.vista() === 'todas' ? await this.bitacora.todasBitacoras() : await this.bitacora.misBitacoras();
      this.bitacoras.set(data);
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
    return formatFechaCortaHora(ms); // Y1 — fecha + hora del último guardado
  }

  /** BL9 — ¿la bitácora es de una fecha distinta al día en que se envió/creó? */
  esDeOtraFecha(b: BitacoraFull): boolean {
    return bitacoraRetrofechada(b.fecha, b.created_at);
  }

  titulo(b: BitacoraFull): string {
    if (b.tipo === 'incidente') return this.i18n.t('Incidente');
    if (b.tipo === 'visita') return this.i18n.t('Visita');
    // BN1 — la app lista el tipo aunque no lo cree; sin este caso una orden de
    // trabajo saldría con el default "Bitácora del día".
    if (b.tipo === 'orden_trabajo') return this.i18n.t('Orden de trabajo');
    // Z4 — deja claro cuando no se trabajó en obra.
    return b.sin_actividad ? this.i18n.t('Bitácora — No se trabajó') : this.i18n.t('Bitácora del día');
  }

  open(b: BitacoraFull): void {
    // BW1 — la orden de trabajo tiene su propia ficha (nº, estado, ver/compartir/enviar).
    if (b.tipo === 'orden_trabajo') {
      void this.router.navigate(['/bitacora/orden-trabajo', b.id]);
      return;
    }
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
