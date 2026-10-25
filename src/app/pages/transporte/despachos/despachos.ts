import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, RequisicionPorDespachar } from '../../../core/services/conduces.service';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { RequisicionDetalle } from '../../../core/models/inventario.model';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { formatFecha, formatFechaDespacho } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/** CP6 — a partir de cuántos días de espera una requisición entra al grupo "atrasadas". */
const DIAS_ATRASADA = 3;

function diasDesde(ts: string): number {
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return 0;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

/**
 * BA/Transporte v3 (FASE 2) — "Por despachar": requisiciones aprobadas que esperan
 * su(s) conduce(s). El chofer "jala" una → abre el conduce con los renglones
 * predeterminados de la requisición (editables) ya enlazado. La aprobación deja de
 * generar conduce automático cuando Xaviel apaga `requisicion_auto_conduce`.
 */
@Component({
  selector: 'app-despachos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, BottomSheet, LiveRefreshDirective, TranslatePipe],
  templateUrl: './despachos.html',
  styleUrl: './despachos.scss',
})
export class DespachosPage {
  private conduces = inject(ConducesService);
  private solicitudes = inject(SolicitudesService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  /** CP6 — glifo desde TS (guarda AW12/no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyphWarn = '⚠️';

  loading = signal(true);
  error = signal('');
  requisiciones = signal<RequisicionPorDespachar[]>([]);

  // CP6 — el server ya ordena más-viejas-primero; solo partimos en 2 grupos conservando ese orden.
  atrasadas = computed(() => this.requisiciones().filter((r) => diasDesde(r.created_at) >= DIAS_ATRASADA));
  recientes = computed(() => this.requisiciones().filter((r) => diasDesde(r.created_at) < DIAS_ATRASADA));

  constructor() {
    void this.cargar();
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.error.set('');
    try {
      this.requisiciones.set(await this.conduces.requisicionesPorDespachar());
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudieron cargar las requisiciones.'));
    } finally {
      this.loading.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.cargar(silent);
  }

  /** CP6 — "Hoy · 8:10 a.m." / "Mié 15 oct · 12:28 p.m." / "hace 3 días". */
  fechaCard(r: RequisicionPorDespachar): string {
    return formatFechaDespacho(r.created_at);
  }

  /** CP6 — urgencia explícita o fecha de necesidad; vacío si no hay ninguna. */
  necesidadTexto(r: RequisicionPorDespachar): string {
    if (r.urgencia === 'urgente') return this.i18n.t('Urgente');
    if (r.fecha_necesidad) return this.i18n.t('Necesita el {f}', { f: formatFecha(r.fecha_necesidad) });
    return '';
  }

  /** Jala la requisición → abre el conduce con sus renglones (editables) y el vínculo.
   *  CX3.5 — se le pasa el evento para no dejarlo subir a la tarjeta y abrir
   *  también la vista rápida (el botón vive DENTRO de la tarjeta clicable). */
  despachar(r: RequisicionPorDespachar, ev?: Event): void {
    ev?.stopPropagation();
    this.quickViewOpen.set(false);
    void this.router.navigate(['/transporte/generar-conduce'], {
      queryParams: { requisicion: r.id, obra: r.proyecto_id, origen: 'almacen' },
    });
  }

  back(): void {
    this.location.back();
  }

  // ── CX3.5 — vista rápida de solo lectura (D7) ───────────────────────────────
  // Tocar la tarjeta YA NO empieza el despacho: abre esta hoja de solo lectura con
  // los renglones, urgencia, necesidad, notas y antigüedad. Solo el botón
  // "Despachar" (en la tarjeta o dentro de la hoja) crea/avanza algo.
  quickViewOpen = signal(false);
  quickViewResumen = signal<RequisicionPorDespachar | null>(null);
  quickViewDetalle = signal<RequisicionDetalle | null>(null);
  quickViewLoading = signal(false);
  quickViewError = signal('');

  /** Fecha corta para la vista rápida (reusa el mismo formateador que `necesidadTexto`). */
  fmtFecha(f: string | null | undefined): string {
    return formatFecha(f);
  }

  /** Antigüedad legible ("hace 22 días" / "hoy") para la cabecera de la vista rápida. */
  antiguedadTexto(r: RequisicionPorDespachar): string {
    const d = diasDesde(r.created_at);
    if (d <= 0) return this.i18n.t('Hoy');
    if (d === 1) return this.i18n.t('hace 1 día');
    return this.i18n.t('hace {n} días', { n: d });
  }

  abrirVista(r: RequisicionPorDespachar): void {
    this.quickViewResumen.set(r);
    this.quickViewDetalle.set(null);
    this.quickViewError.set('');
    this.quickViewOpen.set(true);
    void this.cargarVista(r.id);
  }

  /** Teclado: Enter/Espacio abren la vista rápida igual que el clic (CX4 — foco visible,
   *  toda la fila es accionable). Espacio no debe hacer scroll de la página. */
  onCardKeydown(ev: KeyboardEvent, r: RequisicionPorDespachar): void {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    this.abrirVista(r);
  }

  private async cargarVista(id: string): Promise<void> {
    this.quickViewLoading.set(true);
    const { data, failed } = await this.solicitudes.detalleDetallado(id);
    this.quickViewDetalle.set(data);
    this.quickViewError.set(
      failed && !data ? this.i18n.t('No pudimos cargar el contenido. Revisa la conexión e intenta de nuevo.') : '',
    );
    this.quickViewLoading.set(false);
  }

  reintentarVista(): void {
    const r = this.quickViewResumen();
    if (r) void this.cargarVista(r.id);
  }

  cerrarVista(): void {
    this.quickViewOpen.set(false);
  }

  /** El botón "Despachar" dentro de la hoja reutiliza la fila resumen que la abrió. */
  despacharDesdeVista(): void {
    const r = this.quickViewResumen();
    if (r) this.despachar(r);
  }
}
