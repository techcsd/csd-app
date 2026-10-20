import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, input, viewChild } from '@angular/core';
import { markdownToHtml, resolverImagenesNota } from '../../../core/util/markdown';

/**
 * BP5 — vista de solo lectura de Markdown (Dev notes/Compa). Renderiza con `marked`
 * y SANEA el HTML con DOMPurify antes de inyectarlo (contenido compartido entre
 * usuarios). Sin resaltado de sintaxis (highlight.js) para no engordar el APK: los
 * bloques de código se ven monoespaciados y con scroll horizontal (ver .scss).
 *
 * CS2 — `resolverImagen` es OPCIONAL: sin ella (p. ej. Compa, que no tiene imágenes
 * `nota-img:`) el componente se comporta exactamente igual que antes. Con ella
 * (Dev notes/Notas), las imágenes pegadas en la web se resuelven a su URL firmada
 * real en vez de quedar como ruta rota.
 */
@Component({
  selector: 'app-markdown-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="md" #host [innerHTML]="html()"></div>`,
  styleUrl: './markdown-view.scss',
})
export class MarkdownView {
  source = input<string>('');
  resolverImagen = input<((path: string) => Promise<string | null>) | null>(null);

  private hostEl = viewChild<ElementRef<HTMLElement>>('host');
  private ultimoHtmlResuelto: string | null = null;

  html = computed<string>(() => markdownToHtml(this.source() ?? ''));

  constructor() {
    // afterRenderEffect (no `effect()` a secas): necesitamos que el DOM YA tenga el
    // `[innerHTML]` aplicado antes de buscar `img[data-nota-img-path]`.
    afterRenderEffect(() => {
      const html = this.html();
      const el = this.hostEl()?.nativeElement;
      const resolver = this.resolverImagen();
      if (el && resolver && html !== this.ultimoHtmlResuelto) {
        this.ultimoHtmlResuelto = html;
        void resolverImagenesNota(el, resolver);
      }
    });
  }
}
