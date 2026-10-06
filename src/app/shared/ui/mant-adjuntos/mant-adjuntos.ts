import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PdfViewer } from '../pdf-viewer/pdf-viewer';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { CameraService } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import {
  ADJUNTO_TIPO_LABEL,
  AdjuntoTipoDocumento,
  MantenimientoAdjunto,
  MantenimientosService,
  adjuntoEsPdf,
} from '../../../core/services/mantenimientos.service';

/** CG13 — tope de tamaño del adjunto. El bucket `vehiculos` acepta hasta 15 MB. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * CG13 — chips de adjuntos de un mantenimiento (imagen 🖼️ / PDF 📄) que abren el
 * documento DENTRO del sistema (visor de PDF inline o lightbox de imagen), con opción
 * de *Compartir*; y, si `puedeAdjuntar`, un botón para subir un PDF/foto del taller
 * (offline → outbox). Reutilizable en la lista general, el historial del vehículo y la
 * pantalla de registro.
 */
@Component({
  selector: 'app-mant-adjuntos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PdfViewer, TranslatePipe],
  templateUrl: './mant-adjuntos.html',
  styleUrl: './mant-adjuntos.scss',
})
export class MantAdjuntos {
  private mant = inject(MantenimientosService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  adjuntos = input<MantenimientoAdjunto[]>([]);
  /** Para *Adjuntar*: id del mantenimiento + vehículo. Si faltan, no se puede adjuntar. */
  mantenimientoId = input<string | null>(null);
  vehiculoId = input<string | null>(null);
  puedeAdjuntar = input(false);
  /** CH3 — agrupar los adjuntos por tipo con conteo (detalle/historial). */
  agrupar = input(false);

  /** CH3 — adjuntos agrupados por tipo de documento (orden de primera aparición). */
  grupos = computed(() => {
    const by = new Map<string, MantenimientoAdjunto[]>();
    for (const a of this.adjuntos()) {
      const k = a.tipo_documento || 'otro';
      const arr = by.get(k) ?? by.set(k, []).get(k)!;
      arr.push(a);
    }
    return [...by.entries()].map(([tipo, items]) => ({ tipo, label: this.tipoLabel(tipo), items }));
  });

  readonly tipos: AdjuntoTipoDocumento[] = ['factura', 'informe', 'cotizacion', 'garantia', 'foto', 'otro'];
  tipoLabel = (t: string): string => ADJUNTO_TIPO_LABEL[t as AdjuntoTipoDocumento] ?? t;
  esPdf = adjuntoEsPdf;

  /** Visor abierto (PDF inline o imagen a pantalla completa). */
  visor = signal<{ url: string; nombre: string; esPdf: boolean } | null>(null);
  abriendo = signal(false);
  /** Archivo elegido esperando elegir el tipo de documento. */
  pendiente = signal<{ blob: Blob; nombre: string; mime: string } | null>(null);
  subiendo = signal(false);

  async abrir(a: MantenimientoAdjunto): Promise<void> {
    if (this.abriendo()) return;
    this.abriendo.set(true);
    try {
      const url = await this.mant.signedUrlAdjunto(a.path);
      if (!url) {
        this.toast.error(this.i18n.t('No pudimos abrir el documento. Revisa tu conexión.'));
        return;
      }
      this.visor.set({ url, nombre: a.nombre ?? this.tipoLabel(a.tipo_documento), esPdf: this.esPdf(a) });
    } finally {
      this.abriendo.set(false);
    }
  }

  cerrarVisor(): void {
    this.visor.set(null);
  }

  /** Paso 1 — elegir el archivo (PDF o imagen) del teléfono. */
  async elegirArchivo(): Promise<void> {
    const doc = await this.camera.pickDocument();
    if (!doc) return;
    if (doc.blob.size > MAX_BYTES) {
      this.toast.error(this.i18n.t('El archivo supera el máximo de 15 MB.'));
      return;
    }
    const mime = doc.esImagen ? 'image/jpeg' : 'application/pdf';
    this.pendiente.set({ blob: doc.blob, nombre: doc.nombre, mime });
  }

  cancelarPendiente(): void {
    this.pendiente.set(null);
  }

  /** Paso 2 — elegir el tipo de documento y encolar el adjunto. */
  async confirmarTipo(tipo: AdjuntoTipoDocumento): Promise<void> {
    const p = this.pendiente();
    const mantId = this.mantenimientoId();
    const vehId = this.vehiculoId();
    if (!p || !mantId || !vehId || this.subiendo()) return;
    this.subiendo.set(true);
    try {
      await this.mant.enqueueAdjunto({
        mantenimientoId: mantId,
        vehiculoId: vehId,
        blob: p.blob,
        nombre: p.nombre,
        mime: p.mime,
        tipoDocumento: tipo,
      });
      this.pendiente.set(null);
      this.toast.success(this.i18n.t('Documento adjuntado. Se sube cuando haya señal.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo adjuntar. Intenta de nuevo.'));
    } finally {
      this.subiendo.set(false);
    }
  }
}
