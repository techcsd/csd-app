import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Img } from '../../../shared/ui/img/img';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { AudioNotasService, AudioEntidadTipo } from '../../../core/services/audio-notas.service';
import { ChecklistDetalle, EchadaDetalle, MultaDetalle } from '../../../core/models/flota-reportes.model';
import { RENDIMIENTO_ESTADO_META, RendimientoEstado, RendimientoEstadoMeta } from '../../../core/models/combustible.model';
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
  private audioNotas = inject(AudioNotasService);

  readonly tipo = this.route.snapshot.paramMap.get('tipo') ?? '';
  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly nivelLabel = nivelCombustibleLabel;

  /** AD7 — meta del estado de rendimiento (badge + banda del porqué). */
  rendMeta(estado: RendimientoEstado | null | undefined): RendimientoEstadoMeta | null {
    return estado ? (RENDIMIENTO_ESTADO_META[estado] ?? null) : null;
  }

  loading = signal(true);
  checklist = signal<ChecklistDetalle | null>(null);
  echada = signal<EchadaDetalle | null>(null);
  multa = signal<MultaDetalle | null>(null);
  // Z23/AA22 — notas de voz: URL firmada + transcripción automática (si existe).
  audios = signal<{ url: string; transcripcion: string | null; estado: string | null }[]>([]);
  fmtFecha = formatFecha;

  esChecklist = computed(() => this.tipo === 'checklist');
  esMulta = computed(() => this.tipo === 'multa');
  icono = computed(() => (this.esChecklist() ? '📋' : this.esMulta() ? '🚦' : '⛽'));
  titulo = computed(() => {
    if (this.esMulta()) return 'Multa';
    if (this.esChecklist()) return this.checklist()?.tipo === 'inspeccion' ? 'Inspección de vehículo' : 'Uso de vehículo';
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
        const c = await this.flota.getMiChecklistDetalle(this.id);
        this.checklist.set(c);
        // Z23 — notas de voz del checklist (preuso vs semanal → entidad_tipo).
        if (c) void this.loadAudios(c.tipo === 'inspeccion' ? 'reporte_semanal' : 'preuso');
      } else {
        this.echada.set(await this.flota.getMiEchadaDetalle(this.id));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Z23 — carga y firma las URLs de las notas de voz (best-effort, online). */
  private async loadAudios(entidadTipo: AudioEntidadTipo): Promise<void> {
    try {
      const notas = await this.audioNotas.list(entidadTipo, this.id);
      const items = await Promise.all(
        notas.map(async (n) => ({
          url: await this.audioNotas.signedUrl(n.bucket, n.path),
          transcripcion: n.transcripcion ?? null,
          estado: n.transcripcion_estado ?? null,
        })),
      );
      this.audios.set(items.filter((a) => !!a.url) as { url: string; transcripcion: string | null; estado: string | null }[]);
    } catch {
      /* las notas son secundarias; el detalle se ve igual sin ellas */
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
