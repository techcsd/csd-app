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

/**
 * CS2 — esquema que el editor de notas de la web usa para imágenes pegadas:
 * `![alt](nota-img:<ruta-en-el-bucket>)`. No es una URL cargable (la ruta vive en
 * el bucket privado `notas-imagenes`, requiere una URL firmada) — se guarda así en
 * el Markdown para no "pesar" el contenido con URLs que vencen.
 */
const NOTA_IMG_SCHEME = 'nota-img:';

/** Markdown → HTML saneado, para hidratar el `contenteditable`/vista al abrir una nota.
 *  Las imágenes `nota-img:` quedan SIN `src` (ruta inválida para el navegador) y con
 *  `data-nota-img-path` — `resolverImagenesNota` las completa con la URL firmada real.
 *
 *  OJO (bug real, encontrado probando en un Samsung real): `nota-img:` no es un esquema
 *  de URI que DOMPurify reconozca como seguro — `DOMPurify.sanitize()` se come el `src`
 *  ENTERO antes de que este código pueda leerlo, si se saneara DESPUÉS de convertir.
 *  Por eso la conversión a `data-nota-img-path` pasa ANTES del saneo (sobre el HTML
 *  crudo de `marked`, con una sustitución de texto simple — no ejecuta nada, DOMPurify
 *  sigue limpiando todo lo demás después).
 */
export function markdownToHtml(md: string): string {
  const raw = md ?? '';
  if (!raw.trim()) return '';
  const rendered = marked.parse(raw, { async: false, breaks: true }) as string;
  const pre = rendered.replace(
    /<img([^>]*)\ssrc="nota-img:([^"]*)"([^>]*)>/g,
    '<img$1 class="nota-img-pendiente" data-nota-img-path="$2"$3>',
  );
  return DOMPurify.sanitize(pre, { ADD_ATTR: ['data-nota-img-path'] });
}

/**
 * CS2 — resuelve las imágenes `nota-img:` ya hidratadas en el DOM (`data-nota-img-path`)
 * a su URL firmada real, vía el `resolver` (normalmente `NotasService.resolverImagenUrl`,
 * que pide la URL firmada al bucket privado `notas-imagenes`). Si el bucket/ruta no
 * existe o falla, la imagen queda oculta (nunca una ruta rota visible). Idempotente
 * (marca `data-resuelta` para no repetir la llamada en re-renders).
 */
export async function resolverImagenesNota(
  root: HTMLElement,
  resolver: (path: string) => Promise<string | null>,
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-nota-img-path]:not([data-resuelta])'));
  await Promise.all(
    imgs.map(async (img) => {
      const path = img.getAttribute('data-nota-img-path') ?? '';
      img.setAttribute('data-resuelta', '1');
      const url = path ? await resolver(path).catch(() => null) : null;
      img.classList.remove('nota-img-pendiente');
      if (url) {
        // El signed URL puede "existir" aunque el objeto ya no esté en el bucket
        // (createSignedUrl no siempre valida existencia) — si la carga real falla,
        // se oculta igual (nunca una ruta rota visible).
        img.onerror = () => img.classList.add('nota-img-rota');
        img.src = url;
      } else {
        img.classList.add('nota-img-rota');
      }
    }),
  );
}

/** CS2 — `![alt](nota-img:<ruta>)` de vuelta, a partir del `data-nota-img-path` que
 *  `markdownToHtml` dejó (NUNCA la `src` resuelta — esa es una URL firmada que vence
 *  y no debe guardarse). null si la imagen no tiene ruta (no debería pasar). */
function imgToMd(e: Element): string | null {
  const path = e.getAttribute('data-nota-img-path');
  if (!path) return null;
  return `![${e.getAttribute('alt') ?? ''}](${NOTA_IMG_SCHEME}${path})`;
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
      case 'IMG':
        out += imgToMd(e) ?? '';
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
      case 'IMG': {
        // CS2 — imagen pegada en la web (`nota-img:`): se preserva tal cual, nunca
        // se pisa ni se "aplana" al editar el resto de la nota desde el móvil.
        const md = imgToMd(e);
        if (md) lines.push(md);
        break;
      }
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
