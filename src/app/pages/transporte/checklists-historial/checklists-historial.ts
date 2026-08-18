import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { NetworkService } from '../../../core/services/network.service';
import { ChecklistHistorialRow } from '../../../core/models/flota-reportes.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';

type TipoFiltro = 'todos' | 'pre_uso' | 'inspeccion';

/**
 * Y7 — Historial de checklists (parity con `flota/checklists` de la web). El jefe
 * de flota ve lo que envían los choferes (RLS `chk_veh_sel`: elevado ve todo, el
 * chofer solo los suyos). Lista filtrable (vehículo/conductor/tipo/hallazgos) →
 * detalle reutilizando la pantalla existente `/transporte/mi-registro/checklist`.
 * Online-first (el histórico no necesita offline completo).
 */
@Component({
  selector: 'app-checklists-historial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './checklists-historial.html',
  styleUrl: './checklists-historial.scss',
})
export class ChecklistsHistorialPage {
  private reportes = inject(FlotaReportesService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  rows = signal<ChecklistHistorialRow[]>([]);
  loading = signal(true);
  query = signal('');
  tipo = signal<TipoFiltro>('todos');
  soloHallazgos = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.reportes.getChecklistsHistorial(365));
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  filtrados = computed<ChecklistHistorialRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const tipo = this.tipo();
    const solo = this.soloHallazgos();
    return this.rows().filter((r) => {
      if (tipo !== 'todos' && r.tipo !== tipo) return false;
      if (solo && !(r.tiene_criticos || r.resultado === 'con_hallazgos' || r.resultado === 'bloqueado')) return false;
      if (!q) return true;
      const hay = `${r.vehiculo?.placa ?? ''} ${r.conductor?.nombre ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  // AA5 — el contador debe cuadrar con lo que muestra el filtro y las cards:
  // un checklist "con hallazgos" es el que tiene críticos O resultado
  // con_hallazgos/bloqueado (mismo predicado que `filtrados`).
  criticosCount = computed(
    () =>
      this.rows().filter(
        (r) => r.tiene_criticos || r.resultado === 'con_hallazgos' || r.resultado === 'bloqueado',
      ).length,
  );

  setTipo(t: TipoFiltro): void {
    this.tipo.set(t);
  }

  toggleHallazgos(): void {
    this.soloHallazgos.update((v) => !v);
  }

  tipoLabel(t: string): string {
    return t === 'pre_uso' ? 'Pre-uso' : t === 'inspeccion' ? 'Inspección' : t;
  }

  resultadoLabel(r: string | null): string {
    switch (r) {
      case 'aprobado':
        return 'Aprobado';
      case 'con_hallazgos':
        return 'Con hallazgos';
      case 'bloqueado':
        return 'Bloqueado';
      default:
        return '—';
    }
  }

  fmtFecha(iso: string | null): string {
    return iso ? formatFechaCortaHora(iso) : '—'; // AT17 — fecha + hora
  }

  abrir(r: ChecklistHistorialRow): void {
    void this.router.navigate(['/transporte/mi-registro/checklist', r.id]);
  }

  back(): void {
    this.location.back();
  }
}
