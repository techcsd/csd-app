import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { ObraService } from '../../../core/services/obra.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';
import { ClPendiente } from '../../../core/models/cl-liberacion.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * BH2 — "Dashboard de bitácora": el pulso de la obra en la app, de solo lectura.
 * Agrega RPCs existentes (sin backend nuevo): bitácoras de hoy / la semana,
 * liberaciones por firmar, no conformidades abiertas y actividad por obra. Hueco de
 * capacidad de la web construido en la app.
 */
@Component({
  selector: 'app-bitacora-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class BitacoraDashboardPage {
  private bitacora = inject(BitacoraService);
  private cl = inject(ClLiberacionService);
  private obra = inject(ObraService);
  private router = inject(Router);
  private location = inject(Location);

  readonly fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  bitacoras = signal<BitacoraFull[]>([]);
  clsPend = signal<ClPendiente[]>([]);
  ncAbiertas = signal(0);
  viendoTodas = signal(false);

  private hoyStr = new Date().toISOString().slice(0, 10);
  private hace7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  hoyCount = computed(() => this.bitacoras().filter((b) => (b.fecha ?? '').slice(0, 10) === this.hoyStr).length);
  semanaCount = computed(() => this.bitacoras().filter((b) => (b.fecha ?? '') >= this.hace7).length);
  liberacionesPend = computed(() => this.clsPend().length);

  /** Actividad de la semana agrupada por obra. */
  porObra = computed(() => {
    const map = new Map<string, number>();
    for (const b of this.bitacoras()) {
      if ((b.fecha ?? '') < this.hace7) continue;
      const nom = b.proyecto?.nombre ?? 'Sin obra';
      map.set(nom, (map.get(nom) ?? 0) + 1);
    }
    return [...map.entries()].map(([obra, n]) => ({ obra, n })).sort((a, b) => b.n - a.n);
  });

  recientes = computed(() => this.bitacoras().slice(0, 8));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const puedeTodas = await this.bitacora.puedeVerOtrasBitacoras().catch(() => false);
      this.viendoTodas.set(puedeTodas);
      const [bitas, cls, nc] = await Promise.all([
        puedeTodas ? this.bitacora.todasBitacoras() : this.bitacora.misBitacoras(),
        this.cl.getClsPendientes().catch(() => [] as ClPendiente[]),
        this.obra.misNcAsignadas().catch(() => []),
      ]);
      this.bitacoras.set(bitas);
      this.clsPend.set(cls);
      this.ncAbiertas.set(nc.filter((n) => n.estado === 'abierta' || n.estado === 'en_correccion').length);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(b: BitacoraFull): string {
    return b.tipo === 'incidente' ? '⚠️ Incidente' : '📓 Parte diario';
  }

  irABitacora(): void {
    void this.router.navigate(['/bitacora']);
  }
  irALiberaciones(): void {
    void this.router.navigate(['/bitacora/cl']);
  }

  back(): void {
    this.location.back();
  }
}
