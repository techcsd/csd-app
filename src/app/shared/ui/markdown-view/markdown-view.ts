import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, viewChild } from '@angular/core';
import { agruparImagenesConsecutivas, markdownToHtml, resolverImagenesNota } from '../../../core/util/markdown';
import { PhotoViewerService } from '../photo-viewer/photo-viewer.service';

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
 *
 * DB2 — imágenes consecutivas (sin texto entre ellas) se agrupan en una galería
 * horizontal de miniaturas (`agruparImagenesConsecutivas`); tocar cualquier imagen
 * (agrupada o suelta) abre el visor a pantalla completa (`PhotoViewerService`, el
 * mismo que usa la foto de perfil), con flechas/contador cuando hay más de una.
 */
@Component({
  selector: 'app-markdown-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="md" #host [innerHTML]="html()" (click)="onClick($event)"></div>`,
  styleUrl: './markdown-view.scss',
})
export class MarkdownView {
  private photoViewer = inject(PhotoViewerService);

  source = input<string>('');
  resolverImagen = input<((path: string) => Promise<string | null>) | null>(null);

  private hostEl = viewChild<ElementRef<HTMLElement>>('host');
  private ultimoHtmlResuelto: string | null = null;

  html = computed<string>(() => markdownToHtml(this.source() ?? ''));

  constructor() {
    // afterRenderEffect (no `effect()` a secas): necesitamos que el DOM YA tenga el
    // `[innerHTML]` aplicado antes de buscar `img[data-nota-img-path]` / agrupar.
    afterRenderEffect(() => {
      const html = this.html();
      const el = this.hostEl()?.nativeElement;
      if (!el || html === this.ultimoHtmlResuelto) return;
      this.ultimoHtmlResuelto = html;
      agruparImagenesConsecutivas(el);
      const resolver = this.resolverImagen();
      if (resolver) void resolverImagenesNota(el, resolver);
    });
  }

  /** DB2 — tocar una imagen (suelta o dentro de una galería) abre el visor a pantalla
   *  completa. Imágenes aún sin resolver o rotas (CS2) no abren nada. */
  onClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement;
    const img = target.closest('img') as HTMLImageElement | null;
    if (!img || !img.src || img.classList.contains('nota-img-pendiente') || img.classList.contains('nota-img-rota')) return;
    const galeria = img.closest('.md-galeria');
    if (galeria) {
      const imgs = Array.from(galeria.querySelectorAll('img'));
      this.photoViewer.openGaleria(
        imgs.map((i) => i.src),
        imgs.indexOf(img),
        img,
      );
    } else {
      this.photoViewer.open(img.src, img);
    }
  }
}
