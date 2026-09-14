import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * BP5 — vista de solo lectura de Markdown (Dev notes). Renderiza con `marked` y
 * SANEA el HTML con DOMPurify antes de inyectarlo (contenido compartido entre
 * usuarios). Sin resaltado de sintaxis (highlight.js) para no engordar el APK: los
 * bloques de código se ven monoespaciados y con scroll horizontal (ver .scss).
 */
@Component({
  selector: 'app-markdown-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="md" [innerHTML]="html()"></div>`,
  styleUrl: './markdown-view.scss',
})
export class MarkdownView {
  source = input<string>('');

  html = computed<string>(() => {
    const raw = this.source() ?? '';
    if (!raw.trim()) return '';
    // marked.parse es síncrono en la configuración por defecto (async: false).
    const rendered = marked.parse(raw, { async: false, breaks: true }) as string;
    return DOMPurify.sanitize(rendered);
  });
}
