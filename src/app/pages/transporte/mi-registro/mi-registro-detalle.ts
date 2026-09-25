import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Img } from '../../../shared/ui/img/img';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { AudioNotasService, AudioEntidadTipo } from '../../../core/services/audio-notas.service';
import { ChecklistDetalle, EchadaDetalle, MultaDetalle } from '../../../core/models/flota-reportes.model';
import { EchadaRevision, RENDIMIENTO_ESTADO_META, RendimientoEstado, RendimientoEstadoMeta, revisionMeta } from '../../../core/models/combustible.model';
import { nivelCombustibleLabel } from '../../../core/models/transporte.model';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

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
  imports: [DecimalPipe, Skeleton, EmptyState, Img, TranslatePipe],
  templateUrl: './mi-registro-detalle.html',
  styleUrl: './mi-registro-detalle.scss',
})
export class MiRegistroDetallePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private flota = inject(FlotaReportesService);
  private audioNotas = inject(AudioNotasService);
  private i18n = inject(I18nService);

  readonly tipo = this.route.snapshot.paramMap.get('tipo') ?? '';
  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly nivelLabel = nivelCombustibleLabel;

  /** AD7 — meta del estado de rendimiento (badge + banda del porqué). */
  rendMeta(estado: RendimientoEstado | null | undefined): RendimientoEstadoMeta | null {
    return estado ? (RENDIMIENTO_ESTADO_META[estado] ?? null) : null;
  }

  /** BY1 — meta del chip de revisión (En espera / Aprobada / Rechazada) o null. */
  revMeta(r: EchadaRevision | null | undefined): RendimientoEstadoMeta | null {
    return revisionMeta(r);
  }

  /** BY1/BY5 — ¿esta echada fue rechazada? (habilita "Corregir y reenviar"). */
  esRechazada = computed(() => this.echada()?.revision === 'rechazada');

  /**
   * BY5 — corrige y reenvía una echada rechazada: abre el wizard de combustible
   * prellenado (?reenviar=id). Crea una NUEVA echada vinculada; la rechazada queda.
   */
  corregirYReenviar(): void {
    const e = this.echada();
    if (!e) return;
    void this.router.navigate(['/transporte/combustible'], { queryParams: { reenviar: e.id } });
  }

  loading = signal(true);
  checklist = signal<ChecklistDetalle | null>(null);
  echada = signal<EchadaDetalle | null>(null);
  multa = signal<MultaDetalle | null>(null);
  // Z23/AA22 — notas de voz: URL firmada + transcripción automática (si existe).
  audios = signal<{ url: string; transcripcion: string | null; estado: string | null }[]>([]);
  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaHumana; // AT22 — fecha + hora exacta en el detalle

  esChecklist = computed(() => this.tipo === 'checklist');
  esMulta = computed(() => this.tipo === 'multa');
  icono = computed(() => (this.esChecklist() ? '📋' : this.esMulta() ? '🚦' : '⛽'));
  titulo = computed(() => {
    if (this.esMulta()) return this.i18n.t('Multa');
    if (this.esChecklist()) return this.checklist()?.tipo === 'inspeccion' ? this.i18n.t('Inspección de vehículo') : this.i18n.t('Uso de vehículo');
    return this.i18n.t('Echada de combustible');
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
    return e === 'pagada' ? '✓ ' + this.i18n.t('Pagada') : '⏳ ' + this.i18n.t('Pendiente de pago');
  }

  resultadoLabel(r: string | null): string {
    return r === 'bloqueado' ? '⛔ ' + this.i18n.t('Bloqueado') : r === 'con_hallazgos' ? '⚠ ' + this.i18n.t('Con hallazgos') : '✓ ' + this.i18n.t('Aprobado');
  }
  resultadoBadge(r: string | null): string {
    return r === 'bloqueado' ? 'error' : r === 'con_hallazgos' ? 'warn' : 'ok';
  }
  respLabel(r: string): string {
    return r === 'ok' ? this.i18n.t('OK') : r === 'no' ? this.i18n.t('Falla') : this.i18n.t('N/A');
  }

  back(): void {
    this.location.back();
  }
}
