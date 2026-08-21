import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { ConducesService, ConduceDetalle } from '../../../core/services/conduces.service';
import { ConducePdfService } from '../../../core/services/conduce-pdf.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

/** Etiquetas de fase del conduce (homologado con la web). */
const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En ruta',
  entregando: 'Entregando',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado incompleto',
  pendiente_firma: 'Pendiente de firma',
  confirmado: 'Confirmado',
};

/** AS3 — etiquetas legibles del "Motivo" del conduce (evita mostrar el valor
 *  crudo como `uso_proyecto`). Desconocidos se muestran prettificados. */
const MOTIVO_LABEL: Record<string, string> = {
  uso_proyecto: 'Uso en proyecto',
  uso_en_proyecto: 'Uso en proyecto',
  devolucion: 'Devolución',
  devolucion_suplidor: 'Devolución a suplidor',
  devolucion_obra: 'Devolución de obra',
  traspaso: 'Traspaso entre almacenes',
  compra: 'Compra / entrada',
  entrada: 'Entrada',
  venta: 'Venta',
  reparacion: 'Reparación',
  prestamo: 'Préstamo',
};

/** Prettifica un valor crudo tipo enum (`uso_proyecto` → "Uso proyecto"). */
function prettify(v: string): string {
  const s = v.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : v;
}

/**
 * AL9/AL13/AL4 — Detalle de un conduce (documento). Fuente única abierta desde
 * "Pendiente entrega", "Por confirmar", "Confirmaciones" e "Histórico". Refleja
 * SIEMPRE el portador y estado actual (arregla el render de fila vieja tras una
 * transferencia). Base visual del "Ver conduce" (PDF) de la FASE 2.
 */
@Component({
  selector: 'app-conduce-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, ConfirmDialog, SignaturePad],
  templateUrl: './conduce-detalle.html',
  styleUrl: './conduce-detalle.scss',
})
export class ConduceDetallePage {
  private conduces = inject(ConducesService);
  private pdf = inject(ConducePdfService);
  private route = inject(ActivatedRoute);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private userCtx = inject(UserContextService);

  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaHumana;

  salidaId = this.route.snapshot.paramMap.get('salidaId') ?? '';
  loading = signal(true);
  detalle = signal<ConduceDetalle | null>(null);
  generando = signal(false);
  confirmarEliminar = signal(false);
  eliminando = signal(false);
  /** AT10 — marcar/desmarcar el conduce como dato de prueba (admin). */
  marcandoPrueba = signal(false);
  esAdmin = computed(() => this.userCtx.esAdmin());
  /** AS5 — url de la foto ampliada (lightbox). */
  lightboxUrl = signal<string | null>(null);
  /** AS2 — firma remota del despachante. */
  private sigPad = viewChild<SignaturePad>('despPad');
  firmandoDespachante = signal(false);
  firmaLista = signal(false);
  guardandoFirma = signal(false);

  /** AS2 — ¿puedo firmar este conduce como despachante? (soy el designado y falta). */
  puedeFirmarDespachante = computed(() => {
    const d = this.detalle();
    if (!d) return false;
    return !!d.firma_despachante_pendiente && d.despachante_usuario_id === this.userCtx.profile()?.id;
  });

  /** AS3 — "Motivo" legible: prefiere la etiqueta del servidor (homologada con la
   *  web), cae al mapa local y por último prettifica el valor crudo. */
  motivoLabel = computed(() => {
    const d = this.detalle();
    if (d?.motivo_label) return d.motivo_label;
    const m = d?.motivo;
    if (!m) return '';
    return MOTIVO_LABEL[m] ?? prettify(m);
  });

  /** AS3 — "Entregado por" = despachante (quien entregó el material al chofer). */
  entregadoPor = computed(() => this.detalle()?.despachante || '—');

  /** AS5 — abre/cierra la foto de evidencia en grande. */
  verGrande(url: string | null | undefined): void {
    if (url) this.lightboxUrl.set(url);
  }
  cerrarLightbox(): void {
    this.lightboxUrl.set(null);
  }

  faseLabel = computed(() => {
    const d = this.detalle();
    if (!d) return '';
    return FASE_LABEL[d.fase ?? ''] ?? FASE_LABEL[d.estado ?? ''] ?? d.fase ?? d.estado ?? '—';
  });
  incompleto = computed(() => this.detalle()?.estado === 'entregado_incompleto');
  entregado = computed(() => {
    const e = this.detalle()?.estado ?? '';
    return e !== 'despachado' && e !== 'anulado';
  });
  destino = computed(() => {
    const d = this.detalle();
    return d?.proyecto || d?.destino_almacen || '—';
  });

  /**
   * AQ10 — mostrar "Eliminar" solo cuando el estado/rol lo permite: el conduce está
   * PENDIENTE (despachado, sin receptor) y el usuario es el emisor o un admin. El
   * server (anular_conduce) revalida; esto solo evita ofrecer una acción que fallaría.
   */
  puedeEliminar = computed(() => {
    const d = this.detalle();
    if (!d) return false;
    const pendiente = d.estado === 'despachado' && !d.recibido_por;
    const soyEmisor = !!d.creado_por && d.creado_por === this.userCtx.profile()?.id;
    return pendiente && (soyEmisor || this.userCtx.esAdmin());
  });

  constructor() {
    void this.load();
  }

  // ── AS2 — firmar como despachante ───────────────────────────────────────────
  onFirmaChange(hasContent: boolean): void {
    this.firmaLista.set(hasContent);
  }

  async firmarComoDespachante(): Promise<void> {
    if (this.guardandoFirma()) return;
    const blob = await this.sigPad()?.toBlob();
    if (!blob) {
      this.toast.error('Firma en el recuadro para continuar.');
      return;
    }
    this.guardandoFirma.set(true);
    try {
      await this.conduces.firmarComoDespachante(this.salidaId, blob);
      this.toast.success('Conduce firmado. El chofer ya puede marcar la entrega.');
      this.firmandoDespachante.set(false);
      this.firmaLista.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo firmar el conduce.');
    } finally {
      this.guardandoFirma.set(false);
    }
  }

  async load(): Promise<void> {
    if (!this.salidaId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      this.detalle.set(await this.conduces.conduceDetalleApp(this.salidaId));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar el conduce.');
    } finally {
      this.loading.set(false);
    }
  }

  /** AL4 — compartir el PDF (share sheet → WhatsApp). */
  async compartir(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para generar el PDF del conduce.');
      return;
    }
    if (this.generando()) return;
    this.generando.set(true);
    try {
      await this.pdf.compartir(d);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo compartir el conduce.');
    } finally {
      this.generando.set(false);
    }
  }

  /** AL4 — descargar el PDF al teléfono. */
  async descargar(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para generar el PDF del conduce.');
      return;
    }
    if (this.generando()) return;
    this.generando.set(true);
    try {
      const dest = await this.pdf.descargar(d);
      this.toast.success(`PDF guardado: ${dest}`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo descargar el conduce.');
    } finally {
      this.generando.set(false);
    }
  }

  /** AT10 — alterna es_prueba del conduce (admin, online). */
  async togglePrueba(): Promise<void> {
    const d = this.detalle();
    if (!d || this.marcandoPrueba()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para cambiar esto.');
      return;
    }
    const nuevo = !d.es_prueba;
    this.marcandoPrueba.set(true);
    try {
      await this.conduces.marcarConducePrueba(d.id, nuevo);
      this.toast.success(nuevo ? 'Conduce marcado como prueba.' : 'El conduce ya no es de prueba.');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar la marca de prueba.');
    } finally {
      this.marcandoPrueba.set(false);
    }
  }

  /** AQ10 — abre la advertencia de eliminación. */
  pedirEliminar(): void {
    this.confirmarEliminar.set(true);
  }

  /** AQ10 — confirma: encola el anular_conduce (repone stock + cancela ruta) y sale. */
  async eliminar(): Promise<void> {
    const d = this.detalle();
    if (!d || this.eliminando()) return;
    this.eliminando.set(true);
    try {
      await this.conduces.eliminarConduce(d.id);
      this.confirmarEliminar.set(false);
      this.toast.success(
        this.network.online()
          ? `Conduce ${d.numero} eliminado. Se repuso su stock.`
          : 'Se eliminará al reconectar. Ya no aparecerá en tus listados.',
      );
      this.navGuard.back('/transporte/conduces-hub');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el conduce.');
    } finally {
      this.eliminando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
