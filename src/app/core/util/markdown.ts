import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * CQ2 — Dev notes editable: conversión Markdown ↔ HTML para el editor enriquecido
 * (contenteditable + execCommand, mismo patrón de `nota-editor.ts`). El contenido
 * SIGUE guardándose como Markdown plano en `sgc.notas.contenido` (formato='markdown',
 * igual que la web) — estas funciones solo sirven de puente visual en el editor.
 *
 * `htmlToMarkdown` cubre un subconjunto a propósito (h1-h3, bold/italic, listas,
 * saltos de línea, texto plano): estructuras más ricas que puedan llegar de la web
 * (bloques de código, tablas, citas) se ven bien al ABRIR la nota (vía
 * `markdownToHtml`, que usa `marked` — soporta todo Markdown), pero si el usuario
 * EDITA esa nota en modo enriquecido esas estructuras se aplanan a texto en el
 * siguiente guardado. El modo "Texto simple" (textarea cruda) evita esa pérdida.
 */

/** Markdown → HTML saneado, para hidratar el `contenteditable` al abrir una nota. */
export function markdownToHtml(md: string): string {
  const raw = md ?? '';
  if (!raw.trim()) return '';
  const rendered = marked.parse(raw, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(rendered);
}

/** Texto inline (negrita/cursiva/saltos) dentro de un bloque — recursivo. */
function inlineToMd(el: Element): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as Element;
    switch (e.tagName) {
      case 'BR':
        out += '\n';
        break;
      case 'B':
      case 'STRONG':
        out += `**${inlineToMd(e)}**`;
        break;
      case 'I':
      case 'EM':
        out += `*${inlineToMd(e)}*`;
        break;
      default:
        out += inlineToMd(e); // U y demás: sin equivalente Markdown simple → pasa el texto
    }
  }
  return out;
}

/** Bloques (encabezados/listas/párrafos) → líneas Markdown — recursivo. */
function blockToMd(el: Element): string[] {
  const lines: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent ?? '').trim();
      if (t) lines.push(t);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as Element;
    switch (e.tagName) {
      case 'H1':
        lines.push(`# ${inlineToMd(e).trim()}`);
        break;
      case 'H2':
        lines.push(`## ${inlineToMd(e).trim()}`);
        break;
      case 'H3':
        lines.push(`### ${inlineToMd(e).trim()}`);
        break;
      case 'UL':
        for (const li of Array.from(e.children)) {
          if (li.tagName === 'LI') lines.push(`- ${inlineToMd(li).trim()}`);
        }
        break;
      case 'OL': {
        let i = 1;
        for (const li of Array.from(e.children)) {
          if (li.tagName === 'LI') {
            lines.push(`${i}. ${inlineToMd(li).trim()}`);
            i++;
          }
        }
        break;
      }
      case 'DIV':
      case 'P':
        // El WebView suele envolver cada línea escrita en su propio DIV/P (sin
        // bloques anidados reales en este editor) → cada uno es una línea nueva.
        lines.push(...blockToMd(e));
        break;
      case 'BR':
        lines.push('');
        break;
      default: {
        const t = inlineToMd(e).trim();
        if (t) lines.push(t);
      }
    }
  }
  return lines;
}

/** HTML del `contenteditable` → Markdown plano (lo que se guarda en `contenido`). */
export function htmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html ?? '';
  const lines = blockToMd(div);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Quita negrita/cursiva/tachado/código inline y deja enlaces como "texto (url)". */
function aplicarEnfasisInline(texto: string): string {
  return texto
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // [texto](url)
    .replace(/~~(.+?)~~/g, '$1') // ~~tachado~~
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1') // ***negrita cursiva***
    .replace(/\*\*(.+?)\*\*/g, '$1') // **negrita**
    .replace(/__(.+?)__/g, '$1') // __negrita__
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1') // *cursiva*
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1') // _cursiva_
    .replace(/`([^`]+)`/g, '$1'); // `código`
}

/**
 * CQ2 — "Mandar a ronda": Markdown → texto plano legible para pegar en un chat
 * que no renderiza Markdown (WhatsApp, etc). Espejo exacto del `markdownAPlano`
 * de la web (`src/shared/utils/markdown-a-plano.util.ts`) para que el texto
 * copiado se vea igual venga de donde venga.
 */
export function markdownAPlano(markdown: string): string {
  const lineas = (markdown ?? '').split('\n');
  const out: string[] = [];
  let enBloqueCodigo = false;

  for (const linea of lineas) {
    if (/^\s*```/.test(linea)) {
      enBloqueCodigo = !enBloqueCodigo;
      continue;
    }
    if (enBloqueCodigo) {
      out.push(linea);
      continue;
    }

    let l = linea;

    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
      l = l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
        .join(' — ');
      out.push(l);
      continue;
    }

    const checkbox = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(l);
    if (checkbox) {
      const marcado = checkbox[2].toLowerCase() === 'x';
      l = `${checkbox[1]}${marcado ? '☑' : '☐'} ${checkbox[3]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    const heading = /^(\s*)#{1,6}\s+(.*)$/.exec(l);
    if (heading) {
      l = `${heading[1]}${heading[2]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    const cita = /^(\s*)>\s?(.*)$/.exec(l);
    if (cita) {
      l = `${cita[1]}${cita[2]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) {
      out.push('—————');
      continue;
    }

    out.push(aplicarEnfasisInline(l));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
