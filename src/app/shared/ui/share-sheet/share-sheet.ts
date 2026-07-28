import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';
import { ExportService, type ExportDoc, type ExportFormat } from '../../../core/services/export.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Y3 — hoja para elegir el formato al compartir: **PDF** o **Excel**. Genera el
 * archivo localmente (ExportService) y lo manda por el share sheet nativo (el
 * usuario elige WhatsApp u otra app). Reutilizable en cualquier pantalla que
 * comparta: se le pasa `[open]` y `[doc]` y emite `closed`.
 */
@Component({
  selector: 'app-share-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet],
  templateUrl: './share-sheet.html',
  styleUrl: './share-sheet.scss',
})
export class ShareSheet {
  private exporter = inject(ExportService);
  private toast = inject(ToastService);

  open = input<boolean>(false);
  doc = input<ExportDoc | null>(null);
  closed = output<void>();

  busy = signal<ExportFormat | null>(null);

  async pick(format: ExportFormat): Promise<void> {
    const doc = this.doc();
    if (!doc || this.busy()) return;
    this.busy.set(format);
    try {
      const res = await this.exporter.share(doc, format);
      if (res.fallback) this.toast.success('Archivo descargado. Compártelo desde tus descargas.');
      this.closed.emit();
    } catch {
      this.toast.error('No se pudo generar el archivo.');
    } finally {
      this.busy.set(null);
    }
  }

  cerrar(): void {
    if (this.busy()) return;
    this.closed.emit();
  }
}
