import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { PdfViewer } from '../../../shared/ui/pdf-viewer/pdf-viewer';
import { ConducesService, ConduceExternoFicha } from '../../../core/services/conduces.service';
import { ConducePdfService } from '../../../core/services/conduce-pdf.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatFechaHumana } from '../../../core/util/fecha';

/**
 * CC5 — ficha del conduce externo: un conduce de verdad (cabecera, transportista,
 * origen→destino, renglones o texto, fotos, firmas, estado e historial), con Ver PDF /
 * Compartir (misma plantilla del conduce normal, rótulo "Conduce externo") y Anular con
 * motivo. Soporta el modo "Pendiente de enviar" (armado desde el outbox, aún sin número).
 */
@Component({
  selector: 'app-conduce-externo-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, PdfViewer, TranslatePipe],
  templateUrl: './conduce-externo-detalle.html',
  styleUrl: './conduce-externo-detalle.scss',
})
export class ConduceExternoDetallePage {
  private conduces = inject(ConducesService);
  private pdf = inject(ConducePdfService);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  private id = this.route.snapshot.paramMap.get('id') ?? '';
  private esPendienteParam = this.route.snapshot.queryParamMap.get('pendiente') === '1';

  loading = signal(true);
  ficha = signal<ConduceExternoFicha | null>(null);
  online = this.net.online;
  fmt = formatFechaHumana;

  pdfSrc = signal<string | null>(null);
  generandoPdf = signal(false);
  compartiendo = signal(false);
  fotoAbierta = signal<string | null>(null);

  anularPaso = signal(false);
  anulando = signal(false);
  motivoAnular = signal('');

  /** El emisor / roles elevados pueden anular; el servidor revalida el gate. */
  puedeAnular = computed(() => {
    const f = this.ficha();
    if (!f || f.pendiente || f.anulado) return false;
    return this.ctx.esFlotaElevado() || this.ctx.esAdmin();
  });

  fotos = computed(() => {
    const f = this.ficha();
    if (!f) return [] as { label: string; url: string }[];
    const out: { label: string; url: string }[] = [];
    if (f.placa_foto_url) out.push({ label: this.i18n.t('Placa'), url: f.placa_foto_url });
    if (f.carga_foto_url) out.push({ label: this.i18n.t('Carga'), url: f.carga_foto_url });
    if (f.recepcion_foto_url) out.push({ label: this.i18n.t('Recepción'), url: f.recepcion_foto_url });
    return out;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // Pendiente (outbox) primero si lo pide la ruta o si no hay red; si no, servidor.
      if (this.esPendienteParam) {
        this.ficha.set(await this.conduces.conduceExternoFichaPendiente(this.id));
      } else {
        try {
          this.ficha.set(await this.conduces.conduceExternoFicha(this.id));
        } catch {
          // Puede ser un pendiente aún no sincronizado → intentar desde el outbox.
          this.ficha.set(await this.conduces.conduceExternoFichaPendiente(this.id));
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(): string {
    const f = this.ficha();
    if (!f) return '';
    if (f.pendiente) return f.estado === 'error' ? this.i18n.t('Con problema') : this.i18n.t('Pendiente de enviar');
    switch (f.estado) {
      case 'emitido':
        return this.i18n.t('Emitido');
      case 'recibido':
        return this.i18n.t('Recibido');
      case 'anulado':
        return this.i18n.t('Anulado');
      default:
        return f.estado ?? '—';
    }
  }

  async verPdf(): Promise<void> {
    const f = this.ficha();
    if (!f || this.generandoPdf()) return;
    this.generandoPdf.set(true);
    try {
      const blob = await this.pdf.blob(this.conduces.fichaExternaAConduceDetalle(f), 'Conduce externo');
      this.pdfSrc.set(URL.createObjectURL(blob));
    } catch {
      this.toast.error(this.i18n.t('No se pudo generar el PDF.'));
    } finally {
      this.generandoPdf.set(false);
    }
  }
  cerrarPdf(): void {
    const src = this.pdfSrc();
    if (src) {
      try {
        URL.revokeObjectURL(src);
      } catch {
        /* ignore */
      }
    }
    this.pdfSrc.set(null);
  }

  async compartir(): Promise<void> {
    const f = this.ficha();
    if (!f || this.compartiendo()) return;
    this.compartiendo.set(true);
    try {
      await this.pdf.compartir(this.conduces.fichaExternaAConduceDetalle(f), 'Conduce externo');
    } catch {
      this.toast.error(this.i18n.t('No se pudo compartir el PDF.'));
    } finally {
      this.compartiendo.set(false);
    }
  }

  // ── Anular ─────────────────────────────────────────────────────────────────
  pedirAnular(): void {
    this.motivoAnular.set('');
    this.anularPaso.set(true);
  }
  async confirmarAnular(): Promise<void> {
    const f = this.ficha();
    const motivo = this.motivoAnular().trim();
    if (!f || this.anulando()) return;
    if (!motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo de la anulación.'));
      return;
    }
    this.anulando.set(true);
    try {
      await this.conduces.anularConduceExterno(f.id, motivo);
      this.toast.success(this.i18n.t('Conduce externo anulado.'));
      this.anularPaso.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo anular.'));
    } finally {
      this.anulando.set(false);
    }
  }
  cancelarAnular(): void {
    this.anularPaso.set(false);
  }

  abrirFoto(url: string): void {
    this.fotoAbierta.set(url);
  }
  cerrarFoto(): void {
    this.fotoAbierta.set(null);
  }

  back(): void {
    this.location.back();
  }
}
