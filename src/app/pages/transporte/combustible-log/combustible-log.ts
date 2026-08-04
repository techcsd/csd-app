import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CombustibleService } from '../../../core/services/combustible.service';
import { ToastService } from '../../../core/services/toast.service';
import { EchadaLog } from '../../../core/models/combustible.model';
import { formatFechaMedia } from '../../../core/util/fecha';

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
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly fechaMedia = formatFechaMedia;

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
    void this.load();
  }

  async load(): Promise<void> {
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
