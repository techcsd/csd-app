import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * AS10 — visor de PDF INLINE (sin salir de la app, sin descargar).
 *
 * El WebView de Android no renderiza PDFs en un `<iframe>`/`<embed>` (queda en
 * blanco), así que usamos pdf.js dibujando cada página en un `<canvas>`. pdf.js
 * se carga **lazy** (`import()` → su propio chunk, fuera del bundle inicial) y el
 * worker (módulo ESM) se comparte a nivel de app (un solo Worker para todos los
 * documentos). Se reutiliza para el chat (AS10) y cualquier PDF de la app.
 */

// Un único worker-module para toda la app (pdf.js lo comparte entre documentos).
// El worker se copia como asset (angular.json) → se resuelve contra el <base href>
// para funcionar igual en la PWA (rutas profundas) y en el WebView de Capacitor.
let pdfjsMod: typeof import('pdfjs-dist') | null = null;
async function cargarPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsMod) return pdfjsMod;
  const mod = await import('pdfjs-dist');
  const workerUrl = new URL('pdf.worker.min.mjs', document.baseURI).href;
  mod.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
  pdfjsMod = mod;
  return mod;
}

@Component({
  selector: 'app-pdf-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pdf-viewer.html',
  styleUrl: './pdf-viewer.scss',
})
export class PdfViewer implements OnDestroy {
  /** URL (firmada) del PDF. */
  src = input.required<string>();
  nombre = input<string>('Documento');
  cerrado = output<void>();

  private canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  loading = signal(true);
  error = signal(false);
  pagina = signal(1);
  totalPaginas = signal(0);
  private escala = signal(1);
  escalaPct = signal(100);

  private pdf: PDFDocumentProxy | null = null;
  private renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
  private destruido = false;
  private ajustada = false; // escala ya encajada al ancho la primera vez

  constructor() {
    afterNextRender(() => void this.cargar());
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.renderTask?.cancel();
    void this.pdf?.destroy();
  }

  private async cargar(): Promise<void> {
    try {
      const pdfjs = await cargarPdfjs();
      const doc = await pdfjs.getDocument({ url: this.src() }).promise;
      if (this.destruido) {
        void doc.destroy();
        return;
      }
      this.pdf = doc;
      this.totalPaginas.set(doc.numPages);
      await this.render();
      this.loading.set(false);
    } catch (e) {
      console.error('[pdf] no se pudo cargar', e);
      this.error.set(true);
      this.loading.set(false);
    }
  }

  private async render(): Promise<void> {
    if (!this.pdf || this.destruido) return;
    const canvas = this.canvasRef()?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const page = await this.pdf.getPage(this.pagina());
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // nitidez sin reventar memoria
    // Encaja el ancho del contenedor la primera vez (fit-to-width).
    if (!this.ajustada) {
      const base = page.getViewport({ scale: 1 });
      const cont = canvas.parentElement?.clientWidth ?? base.width;
      const s = Math.min(2, Math.max(0.4, (cont - 16) / base.width));
      this.escala.set(s);
      this.escalaPct.set(Math.round(s * 100));
      this.ajustada = true;
    }
    const viewport = page.getViewport({ scale: this.escala() * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    this.renderTask?.cancel();
    const task = page.render({ canvasContext: ctx, viewport });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      /* render cancelado por un cambio de página/zoom: se ignora */
    }
  }

  prev(): void {
    if (this.pagina() <= 1) return;
    this.pagina.update((p) => p - 1);
    void this.render();
  }
  next(): void {
    if (this.pagina() >= this.totalPaginas()) return;
    this.pagina.update((p) => p + 1);
    void this.render();
  }
  zoomIn(): void {
    this.escala.update((s) => Math.min(3, s + 0.25));
    this.escalaPct.set(Math.round(this.escala() * 100));
    void this.render();
  }
  zoomOut(): void {
    this.escala.update((s) => Math.max(0.4, s - 0.25));
    this.escalaPct.set(Math.round(this.escala() * 100));
    void this.render();
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
