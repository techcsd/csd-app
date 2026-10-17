import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ComprasTecService } from '../../../core/services/compras-tec.service';
import { CompraTecDetalle, CompraTecRow } from '../../../core/models/compra-tec.model';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { PdfViewer } from '../../../shared/ui/pdf-viewer/pdf-viewer';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/**
 * CO8 — "Compras tecnológicas por aprobar" (solo la parte del aprobador; crear y
 * adjuntar cotización siguen en la web). Lista de `esperando_aprobacion` → ficha
 * con vista previa (PDF/imagen) + renglones + Aprobar/Rechazar (motivo obligatorio).
 */
@Component({
  selector: 'app-compras-tec',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, PdfViewer, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './compras-tec.html',
  styleUrl: './compras-tec.scss',
})
export class ComprasTecPage {
  private service = inject(ComprasTecService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  fmtFechaHora = formatFechaCortaHora;

  loading = signal(true);
  lista = signal<CompraTecRow[]>([]);
  error = signal(false);

  abierta = signal<CompraTecDetalle | null>(null);
  cargandoDetalle = signal(false);
  /** `app-pdf-viewer` es un modal a pantalla completa (no inline) — se abre a demanda. */
  verPdf = signal(false);

  /** 'aprobar' | 'rechazar' | null — qué acción se está confirmando. */
  modo = signal<'aprobar' | 'rechazar' | null>(null);
  motivo = signal('');
  decidiendo = signal(false);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.lista.set(await this.service.pendientesDeAprobar());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async abrir(row: CompraTecRow): Promise<void> {
    this.cargandoDetalle.set(true);
    try {
      const det = await this.service.detalle(row.id);
      if (!det) {
        this.toast.error(this.i18n.t('No pudimos abrir esta compra.'));
        return;
      }
      this.abierta.set(det);
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  /** Cotización "elegida" (o la primera) — la que se ve en la vista previa. */
  cotizacionPrincipal(d: CompraTecDetalle) {
    return d.adjuntos.find((a) => a.elegida) ?? d.adjuntos[0] ?? null;
  }
  /** El resto de las cotizaciones comparadas (todas menos la principal) — para que el aprobador las vea también. */
  otrasCotizaciones(d: CompraTecDetalle) {
    const principal = this.cotizacionPrincipal(d);
    return d.adjuntos.filter((a) => a !== principal);
  }
  esPdf(nombre: string): boolean {
    return /\.pdf$/i.test(nombre);
  }

  /** Suma client-side de los renglones (cantidad × precio unitario) — fallback para compras legacy sin `total` server. */
  private totalItems(d: CompraTecDetalle): number {
    return d.items.reduce((acc, it) => acc + (it.precio_unitario ?? 0) * (it.cantidad ?? 0), 0);
  }

  /** Total autoritativo: el calculado y guardado server-side; si es null (renglón legacy), se suman los artículos. */
  total(d: CompraTecDetalle): number {
    return d.total ?? this.totalItems(d);
  }

  /** Subtotal de un renglón (cantidad × precio unitario). */
  subtotalItem(it: CompraTecDetalle['items'][number]): number {
    return it.cantidad * (it.precio_unitario ?? 0);
  }

  /** `true` cuando hay totales server-side (subtotal + ITBIS) para mostrar el desglose de 3 líneas. */
  tieneDesgloseServidor(d: CompraTecDetalle): boolean {
    return d.subtotal != null && d.itbis != null;
  }

  /**
   * El monto de la cotización elegida y el total de la compra no cuadran
   * (>1% de diferencia) — probablemente un error de captura o un artículo
   * que falta agregar.
   */
  totalNoCuadra(d: CompraTecDetalle): boolean {
    const elegida = d.adjuntos.find((a) => a.elegida);
    const monto = elegida?.monto;
    const total = this.total(d);
    if (monto == null || !total) return false;
    return Math.abs(monto - total) / total > 0.01;
  }

  cerrarDetalle(): void {
    if (this.decidiendo()) return;
    this.abierta.set(null);
    this.modo.set(null);
    this.motivo.set('');
    this.verPdf.set(false);
  }

  tocarAprobar(): void {
    this.modo.set('aprobar');
    this.motivo.set('');
  }
  tocarRechazar(): void {
    this.modo.set('rechazar');
    this.motivo.set('');
  }
  cancelarModo(): void {
    this.modo.set(null);
    this.motivo.set('');
  }

  async confirmar(): Promise<void> {
    const d = this.abierta();
    const m = this.modo();
    if (!d || !m || this.decidiendo()) return;
    const aprobar = m === 'aprobar';
    const motivo = this.motivo().trim();
    if (!aprobar && !motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo del rechazo.'));
      return;
    }
    this.decidiendo.set(true);
    try {
      await this.service.decidir(d.id, aprobar, aprobar ? null : motivo);
      this.toast.success(this.i18n.t(aprobar ? 'Compra aprobada.' : 'Compra rechazada.'));
      this.lista.update((l) => l.filter((r) => r.id !== d.id));
      this.cerrarDetalle();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la decisión.'));
    } finally {
      this.decidiendo.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/tecnologia');
  }
}
