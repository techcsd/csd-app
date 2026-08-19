import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ConduceDetalle } from './conduces.service';
import { formatFecha, formatFechaHumana } from '../util/fecha';

// AS3 — mismas etiquetas que el detalle (conduce-detalle): el PDF debe mostrar el
// motivo legible y el despachante real, no el enum crudo ni entregado_por_nombre (null).
const MOTIVO_LABEL: Record<string, string> = {
  uso_proyecto: 'Uso en proyecto',
  uso_en_proyecto: 'Uso en proyecto',
  devolucion: 'Devolución',
  devolucion_suplidor: 'Devolución a suplidor',
  devolucion_obra: 'Devolución de obra',
  traspaso: 'Traspaso entre almacenes',
  compra: 'Compra / entrada',
  entrada: 'Entrada',
  venta: 'Venta',
  reparacion: 'Reparación',
  prestamo: 'Préstamo',
};
function motivoLabelDe(d: ConduceDetalle): string {
  if (d.motivo_label) return d.motivo_label;
  const m = d.motivo;
  if (!m) return '—';
  const s = m.replace(/_/g, ' ').trim();
  return MOTIVO_LABEL[m] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : m);
}

const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En ruta',
  entregando: 'Entregando',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado incompleto',
  pendiente_firma: 'Pendiente de firma',
  confirmado: 'Confirmado',
};

/**
 * AL4 — genera el PDF del conduce con el MISMO formato que la web (window.print
 * de SGC no produce un archivo compartible; en la app dibujamos ese layout con
 * jsPDF, self-contained, sin CDN). Permite Compartir (share sheet → WhatsApp) y
 * Descargar. Las imágenes (firmas/fotos) se embeben si hay red; si fallan, el PDF
 * sale igual con el resto del documento.
 */
@Injectable({ providedIn: 'root' })
export class ConducePdfService {
  private readonly M = 14; // margen mm
  private readonly PW = 210; // A4 width mm
  private readonly PH = 297; // A4 height mm

  /** Construye el PDF y devuelve el documento jsPDF. */
  async build(d: ConduceDetalle): Promise<jsPDF> {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = this.M;

    // ── Encabezado ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Constructora Scheker & Domínguez', this.M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y += 6;
    doc.text('Conduce de Materiales y Equipos', this.M, y);
    // Meta a la derecha
    doc.setFontSize(9);
    doc.text(`No. Conduce: ${d.numero}`, this.PW - this.M, this.M, { align: 'right' });
    doc.text(
      `Emisión: ${d.created_at ? formatFechaHumana(d.created_at) : formatFecha(d.fecha)}`,
      this.PW - this.M,
      this.M + 5,
      { align: 'right' },
    );
    y += 3;
    doc.setLineWidth(0.5);
    doc.line(this.M, y, this.PW - this.M, y);
    y += 7;

    // ── Estado ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const estado = FASE_LABEL[d.fase ?? ''] ?? FASE_LABEL[d.estado ?? ''] ?? d.fase ?? d.estado ?? '—';
    doc.text(`Estado: ${estado}${d.es_prueba ? '  ·  PRUEBA' : ''}`, this.M, y);
    y += 7;

    // ── Info (2 columnas) ──
    const destino = d.proyecto || d.destino_almacen || '—';
    const rows: [string, string][] = [
      ['Almacén de origen', d.bodega || '—'],
      ['Destino', destino],
      ['Motivo', motivoLabelDe(d)],
      ['Transporta', d.conductor || '—'],
      ['Entregado por', d.despachante || d.entregado_por_nombre || '—'],
      ['Recibido por', d.recibido_por_nombre || '—'],
    ];
    doc.setFontSize(9);
    const colW = (this.PW - this.M * 2) / 2;
    for (let i = 0; i < rows.length; i += 2) {
      const left = rows[i];
      const right = rows[i + 1];
      this.kv(doc, this.M, y, left[0], left[1], colW - 4);
      if (right) this.kv(doc, this.M + colW, y, right[0], right[1], colW - 4);
      y += 11;
    }
    y += 2;

    // ── Materiales (tabla) ──
    const mostrarRecibida = (d.estado ?? '') !== 'despachado';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Materiales', this.M, y);
    y += 5;

    // Columnas dinámicas
    const cols = mostrarRecibida
      ? [{ w: 8 }, { w: 74 }, { w: 26 }, { w: 24 }, { w: 24 }, { w: 26 }]
      : [{ w: 8 }, { w: 92 }, { w: 30 }, { w: 30 }, { w: 22 }];
    const heads = mostrarRecibida
      ? ['#', 'Artículo', 'Código', 'Enviada', 'Recibida', 'Unidad']
      : ['#', 'Artículo', 'Código', 'Enviada', 'Unidad'];
    y = this.tableHeader(doc, y, cols, heads);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    d.items.forEach((it, i) => {
      y = this.ensurePage(doc, y, 8);
      const cells = mostrarRecibida
        ? [
            String(i + 1),
            it.articulo || '—',
            it.codigo || '—',
            this.num(it.cantidad),
            it.cantidad_recibida != null ? this.num(it.cantidad_recibida) : '—',
            it.unidad || '—',
          ]
        : [String(i + 1), it.articulo || '—', it.codigo || '—', this.num(it.cantidad), it.unidad || '—'];
      y = this.tableRow(doc, y, cols, cells);
    });
    if (!d.items.length) {
      doc.text('Sin materiales.', this.M + 2, y + 4);
      y += 8;
    }
    y += 4;

    // ── Notas ──
    if (d.notas_recepcion) {
      y = this.ensurePage(doc, y, 16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Notas de recepción', this.M, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(d.notas_recepcion, this.PW - this.M * 2);
      doc.text(lines, this.M, y);
      y += lines.length * 4 + 4;
    }

    // ── Firmas ──
    y = this.ensurePage(doc, y, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Firmas', this.M, y);
    y += 4;
    const firmaY = y;
    const firmaW = 70;
    let fx = this.M;
    for (const f of d.firmas.slice(0, 2)) {
      const img = await this.toDataUrl(f.firma_url);
      if (img) {
        try {
          doc.addImage(img, 'PNG', fx, firmaY, firmaW, 24);
        } catch {
          /* imagen no embebible → línea */
        }
      }
      doc.setLineWidth(0.3);
      doc.line(fx, firmaY + 26, fx + firmaW, firmaY + 26);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const label = f.nombre || (f.rol === 'emisor' ? 'Entregado por' : 'Recibido por');
      doc.text(label, fx, firmaY + 31);
      fx += firmaW + 12;
    }
    y = firmaY + 38;

    // ── Evidencia (fotos) ──
    const fotos = [d.entrega_foto_url, d.recepcion_foto_url].filter((u): u is string => !!u);
    if (fotos.length) {
      y = this.ensurePage(doc, y, 60);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Evidencia', this.M, y);
      y += 4;
      let ix = this.M;
      for (const u of fotos) {
        const img = await this.toDataUrl(u);
        if (img) {
          try {
            doc.addImage(img, 'JPEG', ix, y, 55, 55);
          } catch {
            /* skip */
          }
        }
        ix += 60;
      }
      y += 58;
    }

    return doc;
  }

  async blob(d: ConduceDetalle): Promise<Blob> {
    const doc = await this.build(d);
    return doc.output('blob');
  }

  /** Compartir el PDF por el share sheet nativo (→ WhatsApp). Web: navigator.share o descarga. */
  async compartir(d: ConduceDetalle): Promise<void> {
    const filename = `${d.numero}.pdf`;
    if (Capacitor.isNativePlatform()) {
      const doc = await this.build(d);
      const base64 = this.stripDataUrl(doc.output('datauristring'));
      const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      await Share.share({ title: d.numero, text: `Conduce ${d.numero}`, url: w.uri, dialogTitle: 'Compartir conduce' });
      return;
    }
    // Web/PWA
    const blob = await this.blob(d);
    const file = new File([blob], filename, { type: 'application/pdf' });
    const navAny = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (navAny.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: d.numero } as ShareData);
      return;
    }
    this.webDownload(blob, filename);
  }

  /** Descargar/guardar el PDF. Native: Documents; Web: descarga del navegador. */
  async descargar(d: ConduceDetalle): Promise<string> {
    const filename = `${d.numero}.pdf`;
    if (Capacitor.isNativePlatform()) {
      const doc = await this.build(d);
      const base64 = this.stripDataUrl(doc.output('datauristring'));
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
      return `Documentos/${filename}`;
    }
    const blob = await this.blob(d);
    this.webDownload(blob, filename);
    return filename;
  }

  // ── Helpers de dibujo ──
  private kv(doc: jsPDF, x: number, y: number, k: string, v: string, w: number): void {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(k.toUpperCase(), x, y);
    doc.setTextColor(20);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(v || '—', w);
    doc.text(lines.slice(0, 2), x, y + 4);
  }

  private tableHeader(doc: jsPDF, y: number, cols: { w: number }[], heads: string[]): number {
    doc.setFillColor(244, 244, 245);
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    doc.rect(this.M, y, totalW, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(20);
    let x = this.M;
    const rightCols = new Set<number>(heads.map((h, i) => (h === 'Enviada' || h === 'Recibida' ? i : -1)).filter((i) => i >= 0));
    heads.forEach((h, i) => {
      if (rightCols.has(i)) doc.text(h, x + cols[i].w - 2, y + 5, { align: 'right' });
      else doc.text(h, x + 2, y + 5);
      x += cols[i].w;
    });
    return y + 7;
  }

  private tableRow(doc: jsPDF, y: number, cols: { w: number }[], cells: string[]): number {
    doc.setTextColor(20);
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    // altura según la celda de artículo (col 1)
    const nameLines = doc.splitTextToSize(cells[1], cols[1].w - 4);
    const h = Math.max(7, nameLines.length * 4 + 3);
    let x = this.M;
    const rightIdx = new Set<number>(
      cols.map((_, i) => (cells[i] && (i === 3 || (cols.length === 6 && i === 4)) ? i : -1)).filter((i) => i >= 0),
    );
    cells.forEach((c, i) => {
      if (i === 1) {
        doc.text(nameLines, x + 2, y + 4);
      } else if (rightIdx.has(i)) {
        doc.text(c, x + cols[i].w - 2, y + 4, { align: 'right' });
      } else {
        doc.text(c, x + 2, y + 4);
      }
      x += cols[i].w;
    });
    doc.setDrawColor(212);
    doc.setLineWidth(0.1);
    doc.line(this.M, y + h, this.M + totalW, y + h);
    return y + h;
  }

  private ensurePage(doc: jsPDF, y: number, need: number): number {
    if (y + need > this.PH - this.M) {
      doc.addPage();
      return this.M;
    }
    return y;
  }

  private num(n: number): string {
    return new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 }).format(n);
  }

  private stripDataUrl(s: string): string {
    const i = s.indexOf('base64,');
    return i >= 0 ? s.slice(i + 7) : s;
  }

  private async toDataUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  private webDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
