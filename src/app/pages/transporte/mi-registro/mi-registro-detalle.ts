import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Img } from '../../../shared/ui/img/img';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { ChecklistDetalle, EchadaDetalle, MultaDetalle } from '../../../core/models/flota-reportes.model';
import { nivelCombustibleLabel } from '../../../core/models/transporte.model';
import { formatFecha } from '../../../core/util/fecha';

/**
 * V2 (follow-up) — detalle de solo lectura de un registro del historial de "Mi
 * actividad": un checklist (pre-uso o semanal), una echada de combustible o una
 * multa (W5). Ruta: /transporte/mi-registro/:tipo/:id
 * (tipo = 'checklist' | 'echada' | 'multa').
 */
@Component({
  selector: 'app-mi-registro-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, Img],
  templateUrl: './mi-registro-detalle.html',
  styleUrl: './mi-registro-detalle.scss',
})
export class MiRegistroDetallePage {
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private flota = inject(FlotaReportesService);

  readonly tipo = this.route.snapshot.paramMap.get('tipo') ?? '';
  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly nivelLabel = nivelCombustibleLabel;

  loading = signal(true);
  checklist = signal<ChecklistDetalle | null>(null);
  echada = signal<EchadaDetalle | null>(null);
  multa = signal<MultaDetalle | null>(null);
  fmtFecha = formatFecha;

  esChecklist = computed(() => this.tipo === 'checklist');
  esMulta = computed(() => this.tipo === 'multa');
  icono = computed(() => (this.esChecklist() ? '📋' : this.esMulta() ? '🚦' : '⛽'));
  titulo = computed(() => {
    if (this.esMulta()) return 'Multa';
    if (this.esChecklist()) return this.checklist()?.tipo === 'inspeccion' ? 'Reporte semanal' : 'Pre-uso';
    return 'Echada de combustible';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.esMulta()) {
        this.multa.set(await this.flota.getMiMultaDetalle(this.id));
      } else if (this.esChecklist()) {
        this.checklist.set(await this.flota.getMiChecklistDetalle(this.id));
      } else {
        this.echada.set(await this.flota.getMiEchadaDetalle(this.id));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** W5 — etiqueta legible del estado de la multa. */
  estadoMultaLabel(e: string | null): string {
    return e === 'pagada' ? '✓ Pagada' : '⏳ Pendiente de pago';
  }

  resultadoLabel(r: string | null): string {
    return r === 'bloqueado' ? '⛔ Bloqueado' : r === 'con_hallazgos' ? '⚠ Con hallazgos' : '✓ Aprobado';
  }
  resultadoBadge(r: string | null): string {
    return r === 'bloqueado' ? 'error' : r === 'con_hallazgos' ? 'warn' : 'ok';
  }
  respLabel(r: string): string {
    return r === 'ok' ? 'OK' : r === 'no' ? 'Falla' : 'N/A';
  }

  back(): void {
    this.location.back();
  }
}
