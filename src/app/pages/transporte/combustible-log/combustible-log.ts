import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CombustibleService } from '../../../core/services/combustible.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { EchadaLog } from '../../../core/models/combustible.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** AQ13 — chips de periodo rápido (mismo patrón que Mi actividad AJ9). */
type PeriodoChip = { id: string; label: string; dias: number };
const PERIODOS: PeriodoChip[] = [
  { id: '1d', label: '1 día', dias: 1 },
  { id: '1s', label: '1 sem', dias: 7 },
  { id: '1m', label: '1 mes', dias: 30 },
  { id: '3m', label: '3 meses', dias: 90 },
  { id: '6m', label: '6 meses', dias: 180 },
  { id: '1a', label: '1 año', dias: 365 },
];

/**
 * AF17 — "Registro de echadas" para roles elevados (admin, jefe de flota,
 * dirección/gerencia). Consume el RPC sgc.log_combustible (ya gateado por rol y
 * con aislamiento de prueba). Resalta saltos de km sospechosos (km_alerta) y
 * consumo anormal. Online-first (una consulta por rango de fecha + búsqueda local).
 */
@Component({
  selector: 'app-combustible-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState],
  templateUrl: './combustible-log.html',
  styleUrl: './combustible-log.scss',
})
export class CombustibleLogPage {
  private combustible = inject(CombustibleService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);

  readonly fechaMedia = formatFechaMedia;
  readonly periodos = PERIODOS;
  periodo = signal<string>('1m');

  // QA-25 — backstop de rol en cliente (además del RPC gateado): solo roles
  // elevados de flota ven el registro de echadas (mismo criterio que Seguimiento).
  autorizado = signal(true);
  loading = signal(true);
  rows = signal<EchadaLog[]>([]);
  q = signal('');
  desde = signal(this.hace(30));
  hasta = signal(this.hoy());

  /** Filtro local por placa / conductor / quién registró. */
  filtradas = computed(() => {
    const q = this.q().trim().toLowerCase();
    const list = this.rows();
    if (!q) return list;
    return list.filter((r) =>
      [r.placa, r.conductor_nombre, r.registrado_nombre]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  });

  sospechosas = computed(() => this.rows().filter((r) => r.km_alerta || r.alerta_consumo).length);

  constructor() {
    if (!this.ctx.esFlotaElevado()) {
      this.autorizado.set(false);
      this.loading.set(false);
      return;
    }
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.autorizado()) return;
    this.loading.set(true);
    try {
      const list = await this.combustible.getLogEchadas({ desde: this.desde(), hasta: this.hasta() });
      this.rows.set(list);
    } catch {
      this.toast.error('No se pudo cargar el registro de echadas.');
    } finally {
      this.loading.set(false);
    }
  }

  esSospechosa(r: EchadaLog): boolean {
    return !!(r.km_alerta || r.alerta_consumo);
  }

  /** AQ13 — chip de periodo rápido: fija el rango de fechas y recarga. */
  setPeriodo(p: PeriodoChip): void {
    this.periodo.set(p.id);
    this.desde.set(this.hace(p.dias));
    this.hasta.set(this.hoy());
    void this.load();
  }

  /** AQ13 — abrir el detalle de la echada (fotos, delta, motivo del flag). */
  abrir(r: EchadaLog): void {
    void this.router.navigate(['/transporte/echada', r.id]);
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }
  private hace(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  back(): void {
    this.location.back();
  }
}
