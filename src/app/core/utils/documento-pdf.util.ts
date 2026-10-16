// CO12/CO13 — convierte el HTML ya fusionado de un documento (plantilla + datos)
// en un PDF A4 para compartir por WhatsApp/imprimir. Mismo patrón que el resto de
// la app (jsPDF + texto posicionado a mano, NUNCA html2canvas — los otros PDF de
// este repo, `orden-trabajo-pdf.service.ts`/`export.service.ts`, evitan deliberadamente
// el render por canvas: es más frágil en WebViews de gama baja). El HTML que sale de
// `plantillas_documento.contenido_html` es sencillo (p/h1-h3/ul/table/hr de TipTap
// o de un Word convertido) — un parser de bloques alcanza; el negrita/cursiva EN
// LÍNEA se aplana a texto plano (limitación conocida, documentada aquí).
import { jsPDF } from 'jspdf';

const NAVY: [number, number, number] = [30, 58, 95];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [90, 90, 100];

type Bloque =
  | { tipo: 'h1' | 'h2' | 'h3'; texto: string }
  | { tipo: 'p'; texto: string }
  | { tipo: 'li'; texto: string }
  | { tipo: 'hr' }
  | { tipo: 'tabla'; filas: string[][] };

function parsearBloques(html: string): Bloque[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Bloque[] = [];
  const walk = (node: Element): void => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const t = (el.textContent ?? '').trim();
        if (t) out.push({ tipo: tag, texto: t });
      } else if (tag === 'p' || tag === 'div') {
        const t = (el.textContent ?? '').trim();
        if (t) out.push({ tipo: 'p', texto: t });
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(el.querySelectorAll('li'))) {
          const t = (li.textContent ?? '').trim();
          if (t) out.push({ tipo: 'li', texto: t });
        }
      } else if (tag === 'table') {
        const filas: string[][] = [];
        for (const tr of Array.from(el.querySelectorAll('tr'))) {
          filas.push(Array.from(tr.querySelectorAll('td,th')).map((c) => (c.textContent ?? '').trim()));
        }
        if (filas.length) out.push({ tipo: 'tabla', filas });
      } else if (tag === 'hr') {
        out.push({ tipo: 'hr' });
      } else if (tag === 'body' || tag === 'html') {
        walk(el);
      }
    }
  };
  walk(doc.body);
  // Degradación: si no se detectó ningún bloque conocido (HTML plano/raro), se usa
  // el texto completo como un único párrafo — nunca un PDF vacío.
  if (!out.length) {
    const t = (doc.body.textContent ?? '').trim();
    if (t) out.push({ tipo: 'p', texto: t });
  }
  return out;
}

export interface DocumentoPdfOpts {
  titulo: string;
}

/** Genera el PDF A4 del documento (Blob listo para compartir/imprimir). */
export function generarDocumentoPdf(contenidoHtmlFinal: string, opts: DocumentoPdfOpts): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 20;
  let y = M;

  const ensure = (need: number): void => {
    if (y + need > H - M) {
      pdf.addPage();
      y = M;
    }
  };

  pdf.setTextColor(...NAVY);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  const tituloLines = pdf.splitTextToSize(opts.titulo, W - 2 * M) as string[];
  pdf.text(tituloLines, M, y);
  y += tituloLines.length * 7 + 6;

  const bloques = parsearBloques(contenidoHtmlFinal);
  for (const b of bloques) {
    if (b.tipo === 'hr') {
      ensure(8);
      pdf.setDrawColor(200);
      pdf.line(M, y, W - M, y);
      y += 8;
      continue;
    }
    if (b.tipo === 'tabla') {
      const cols = Math.max(...b.filas.map((f) => f.length), 1);
      const colW = (W - 2 * M) / cols;
      for (const fila of b.filas) {
        const cells = fila.map((c) => pdf.splitTextToSize(c, colW - 3) as string[]);
        const lines = Math.max(1, ...cells.map((c) => c.length));
        ensure(lines * 5 + 2);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(...INK);
        cells.forEach((c, i) => pdf.text(c, M + i * colW, y));
        y += lines * 5 + 2;
      }
      y += 4;
      continue;
    }
    if (b.tipo === 'h1' || b.tipo === 'h2' || b.tipo === 'h3') {
      const size = b.tipo === 'h1' ? 14 : b.tipo === 'h2' ? 12.5 : 11.5;
      ensure(size * 0.6);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(size);
      pdf.setTextColor(...INK);
      const lines = pdf.splitTextToSize(b.texto, W - 2 * M) as string[];
      ensure(lines.length * (size * 0.42));
      pdf.text(lines, M, y);
      y += lines.length * (size * 0.42) + 3;
      continue;
    }
    // 'p' | 'li'
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10.5);
    pdf.setTextColor(...INK);
    const indent = b.tipo === 'li' ? M + 4 : M;
    const prefix = b.tipo === 'li' ? '• ' : '';
    const lines = pdf.splitTextToSize(prefix + b.texto, W - indent - M) as string[];
    ensure(lines.length * 5.2 + 2);
    pdf.text(lines, indent, y);
    y += lines.length * 5.2 + 3;
  }

  // Pie: generado por CSD App (trazabilidad del snapshot).
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...MUTED);
  pdf.text(`Generado desde CSD App — ${new Date().toLocaleDateString('es-DO')}`, M, H - 10);

  return pdf.output('blob');
}
