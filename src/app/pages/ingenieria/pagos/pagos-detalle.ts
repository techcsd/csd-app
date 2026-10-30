import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { MotionService } from '../../../core/services/motion.service';
import { PagosObraService } from '../../../core/services/pagos-obra.service';
import { ProyectosService, ProyectoPickable } from '../../../core/services/proyectos.service';
import { PlantillasDocumentoService } from '../../../core/services/plantillas-documento.service';
import { PlantillaDocumento, EmpresaLite } from '../../../core/models/plantilla-documento.model';
import { PagoObra, PagoObraLinea } from '../../../core/models/pagos-obra.model';
import { formatFecha } from '../../../core/util/fecha';
import { parseNumeroFlexible } from '../../../core/util/numero';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** `1234.5` → `RD$ 1,234.50` sin depender de Intl/locale (WebView viejo). */
function formatMonto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, dec] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `RD$ ${n < 0 ? '-' : ''}${grouped}.${dec}`;
}

interface LineaEdit {
  montoRaw: string;
  concepto: string;
}

/**
 * A4 — detalle de una semana de pago: líneas (una por trabajador) con monto +
 * concepto editables (mientras la semana esté en borrador y el usuario pueda
 * operar) y firma del descargo por trazo. "Enviar reporte" es la única acción
 * online-only (dispara PDF+correo server-side, pg_net síncrono); el resto
 * (monto/concepto/firma/ausente) va por el outbox (offline-first).
 *
 * Roles de solo-lectura (abogado/gerencia/dirección) ven la MISMA pantalla con
 * todos los controles de escritura ocultos — un único gate `operar()`.
 */
@Component({
  selector: 'app-pagos-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, SignaturePad, ConfirmDialog, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './pagos-detalle.html',
  styleUrl: './pagos-detalle.scss',
})
export class PagosDetallePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private service = inject(PagosObraService);
  private proyectos = inject(ProyectosService);
  private plantillasSvc = inject(PlantillasDocumentoService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private motion = inject(MotionService);

  private sig = viewChild(SignaturePad);

  private pagoId = '';

  /** CP1/AW12 — glifos desde TS (guarda no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyphPagos = '🧾';
  readonly glyphObra = '🏗';
  readonly glyphOffline = '📡';
  readonly glyphEnviado = '📤';

  readonly online = this.network.online;
  readonly fmt = formatFecha;
  readonly fmtMonto = formatMonto;

  loading = signal(true);
  error = signal(false);
  pago = signal<PagoObra | null>(null);
  lineas = signal<PagoObraLinea[]>([]);
  obras = signal<ProyectoPickable[]>([]);
  edits = signal<Record<string, LineaEdit>>({});
  guardandoId = signal<string | null>(null);

  plantilla = signal<PlantillaDocumento | null>(null);
  plantillaLista = signal(false);
  empresa = signal<EmpresaLite | null>(null);

  firmandoId = signal<string | null>(null);
  firmaLista = signal(false);
  firmando = signal(false);
  confirmEnviar = signal(false);
  enviando = signal(false);

  /** Operar = ingeniero/jefe de obra (crear/editar/firmar/enviar). Ver = solo lectura. */
  readonly operar = computed(() => this.ctx.esAdmin() || this.ctx.puedeOperarSubmodulo('ingenieria.pagos'));
  readonly enviado = computed(() => this.pago()?.estado === 'enviado');
  /** Nada se edita si no puede operar O la semana ya se envió. */
  readonly soloLectura = computed(() => !this.operar() || this.enviado());
  readonly firmadosCount = computed(() => this.lineas().filter((l) => l.estado === 'firmado').length);
  readonly puedeEnviar = computed(
    () => this.operar() && !this.enviado() && this.firmadosCount() > 0 && this.online() && !this.enviando(),
  );

  readonly obraNombre = computed(
    () => this.obras().find((o) => o.id === this.pago()?.proyecto_id)?.nombre ?? '',
  );

  readonly lineaFirmando = computed(() => this.lineas().find((l) => l.id === this.firmandoId()) ?? null);

  /** HTML del descargo ya resuelto (snapshot visible antes de firmar), o '' si no hay plantilla. */
  readonly descargoHtml = computed(() => {
    const l = this.lineaFirmando();
    const p = this.pago();
    const pl = this.plantilla();
    if (!l || !p || !pl) return '';
    const buf = this.edits()[l.id];
    const monto = parseNumeroFlexible(buf?.montoRaw, 'monto');
    const valores: Record<string, string> = {
      nombre: l.nombre_snapshot,
      documento: `${l.documento_tipo_snapshot ?? ''} ${l.documento_numero_snapshot ?? ''}`.trim(),
      empresa: this.empresa()?.nombre_comercial || this.empresa()?.razon_social || '',
      desde: formatFecha(p.semana_desde),
      hasta: formatFecha(p.semana_hasta),
      monto: monto != null ? formatMonto(monto) : '',
      concepto: buf?.concepto ?? (l.concepto ?? ''),
      obra: this.obraNombre(),
    };
    return this.plantillasSvc.renderizar(pl.contenido_html, valores, pl.campos ?? []);
  });

  constructor() {
    this.pagoId = this.route.snapshot.paramMap.get('id') ?? '';
    void this.cargar();
    // CF7 — plantilla del descargo + datos de empresa (cacheados, offline-friendly).
    Promise.all([
      this.plantillasSvc.porNombre('descargo_pago_semanal').catch(() => null),
      this.plantillasSvc.getEmpresa().catch(() => null),
    ]).then(([pl, emp]) => {
      this.plantilla.set(pl);
      this.empresa.set(emp);
      this.plantillaLista.set(true);
    });
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const [pago, lineas, obras] = await Promise.all([
        this.service.detalle(this.pagoId),
        this.service.lineas(this.pagoId),
        this.proyectos.getProyectosPickables().catch(() => [] as ProyectoPickable[]),
      ]);
      if (!pago) {
        this.error.set(true);
        return;
      }
      this.pago.set(pago);
      this.lineas.set(lineas);
      this.obras.set(obras);
      this.edits.set(
        Object.fromEntries(
          lineas.map((l) => [l.id, { montoRaw: l.monto != null ? String(l.monto) : '', concepto: l.concepto ?? '' }]),
        ),
      );
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  bufMonto(lineaId: string): string {
    return this.edits()[lineaId]?.montoRaw ?? '';
  }
  bufConcepto(lineaId: string): string {
    return this.edits()[lineaId]?.concepto ?? '';
  }
  onMontoInput(lineaId: string, raw: string): void {
    this.edits.update((e) => ({ ...e, [lineaId]: { ...e[lineaId], montoRaw: raw, concepto: e[lineaId]?.concepto ?? '' } }));
  }
  onConceptoInput(lineaId: string, v: string): void {
    this.edits.update((e) => ({ ...e, [lineaId]: { ...e[lineaId], concepto: v, montoRaw: e[lineaId]?.montoRaw ?? '' } }));
  }

  montoVista(n: number | null): string {
    return n != null ? formatMonto(n) : this.i18n.t('Sin monto');
  }

  async guardarLinea(l: PagoObraLinea): Promise<void> {
    if (this.soloLectura() || this.guardandoId()) return;
    const buf = this.edits()[l.id];
    const monto = parseNumeroFlexible(buf?.montoRaw, 'monto');
    const concepto = (buf?.concepto ?? '').trim() || null;
    this.guardandoId.set(l.id);
    try {
      await this.service.guardarMontoConcepto(l.id, this.pagoId, monto, concepto);
      this.lineas.update((arr) => arr.map((x) => (x.id === l.id ? { ...x, monto, concepto } : x)));
      this.toast.success(
        this.online() ? this.i18n.t('Guardado.') : this.i18n.t('Guardado. Se enviará cuando tengas señal.'),
      );
    } catch (e) {
      this.toast.error(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo guardar.'));
    } finally {
      this.guardandoId.set(null);
    }
  }

  async toggleAusente(l: PagoObraLinea): Promise<void> {
    if (this.soloLectura() || this.guardandoId()) return;
    const nuevoAusente = l.estado !== 'ausente';
    this.guardandoId.set(l.id);
    try {
      await this.service.marcarAusente(l.id, this.pagoId, nuevoAusente);
      this.lineas.update((arr) =>
        arr.map((x) => (x.id === l.id ? { ...x, estado: nuevoAusente ? 'ausente' : 'pendiente' } : x)),
      );
      this.toast.success(nuevoAusente ? this.i18n.t('Marcado ausente.') : this.i18n.t('Deshecho.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo marcar.'));
    } finally {
      this.guardandoId.set(null);
    }
  }

  abrirFirma(l: PagoObraLinea): void {
    if (this.soloLectura() || l.estado === 'firmado') return;
    this.firmandoId.set(l.id);
    this.firmaLista.set(false);
  }

  cancelarFirma(): void {
    this.firmandoId.set(null);
    this.firmaLista.set(false);
    this.sig()?.clear();
  }

  onFirmaChanged(has: boolean): void {
    this.firmaLista.set(has);
  }

  async confirmarFirma(): Promise<void> {
    const l = this.lineaFirmando();
    if (!l || this.firmando()) return;
    const blob = await this.sig()?.toBlob();
    if (!blob) {
      this.toast.error(this.i18n.t('Captura la firma primero.'));
      return;
    }
    const buf = this.edits()[l.id];
    const monto = parseNumeroFlexible(buf?.montoRaw, 'monto');
    const concepto = (buf?.concepto ?? '').trim() || null;
    this.firmando.set(true);
    try {
      await this.service.firmar(l.id, this.pagoId, monto, concepto, blob);
      this.lineas.update((arr) =>
        arr.map((x) => (x.id === l.id ? { ...x, monto, concepto, estado: 'firmado' } : x)),
      );
      this.motion.momento('firma');
      this.toast.success(
        this.online() ? this.i18n.t('Firma registrada.') : this.i18n.t('Firma guardada. Se enviará cuando tengas señal.'),
      );
      this.firmandoId.set(null);
      this.firmaLista.set(false);
    } catch (e) {
      this.toast.error(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo registrar la firma.'));
    } finally {
      this.firmando.set(false);
    }
  }

  pedirEnviar(): void {
    if (!this.puedeEnviar()) return;
    this.confirmEnviar.set(true);
  }
  cancelarEnviar(): void {
    this.confirmEnviar.set(false);
  }

  async confirmarEnviar(): Promise<void> {
    this.confirmEnviar.set(false);
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.service.enviar(this.pagoId);
      await this.cargar(); // BL2 — no confiar en el estado local: recargar desde el servidor.
      this.toast.success(this.i18n.t('Reporte enviado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo enviar el reporte.'));
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
