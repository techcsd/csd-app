import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { DocumentosGeneradosService } from '../../../core/services/documentos-generados.service';
import { ExportService } from '../../../core/services/export.service';
import { DocumentoGenerado } from '../../../core/models/documento-generado.model';
import { generarDocumentoPdf } from '../../../core/utils/documento-pdf.util';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFechaMedia } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** CO12/CO13 — historial de documentos generados, con el badge "Usado en contrato". */
@Component({
  selector: 'app-documentos-historial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
})
export class DocumentosHistorialPage {
  private documentos = inject(DocumentosGeneradosService);
  private exportSvc = inject(ExportService);
  private sanitizer = inject(DomSanitizer);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  lista = signal<DocumentoGenerado[]>([]);

  abierto = signal<DocumentoGenerado | null>(null);
  htmlAbierto = signal<SafeHtml>('');
  compartiendo = signal(false);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const h = await this.documentos.historial();
      this.lista.set(h);
      // "Usado en contrato" — best-effort, solo documentos de categoría contrato.
      void Promise.all(
        h
          .filter((d) => d.plantilla_categoria === 'contrato')
          .map(async (d) => {
            d.usado_en_contrato = await this.documentos.usadoEnContrato(d.id);
            this.lista.update((l) => [...l]);
          }),
      );
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  abrir(d: DocumentoGenerado): void {
    this.abierto.set(d);
    this.htmlAbierto.set(this.sanitizer.bypassSecurityTrustHtml(d.contenido_html_final));
  }
  cerrar(): void {
    this.abierto.set(null);
  }

  async compartir(d: DocumentoGenerado): Promise<void> {
    if (this.compartiendo()) return;
    this.compartiendo.set(true);
    try {
      const blob = generarDocumentoPdf(d.contenido_html_final, { titulo: d.nombre });
      const base = d.nombre.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'documento';
      const res = await this.exportSvc.shareRaw(blob, `${base}.pdf`, 'application/pdf', d.nombre);
      if (res.fallback) this.toast.success(this.i18n.t('Documento descargado. Compártelo desde tus descargas.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo generar el PDF.'));
    } finally {
      this.compartiendo.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/documentos');
  }
}
