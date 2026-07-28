import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

/** Y3 — formato de exportación al compartir. */
export type ExportFormat = 'pdf' | 'excel';

/** Una tabla plana (mismas columnas en todas las filas). */
export interface ExportTable {
  columns: string[];
  rows: (string | number | null)[][];
  /** Pesos relativos de ancho de columna para el PDF (opcional, def. iguales). */
  colWeights?: number[];
}

/**
 * Y3 — documento genérico exportable a PDF o Excel. Lo arma cada pantalla que
 * comparte (salida/entrada/requisición…) y lo consume el ExportService. Formato
 * consistente: encabezado con nombre de la empresa, metadatos clave→valor, una
 * tabla, y un pie opcional.
 */
export interface ExportDoc {
  title: string;
  /** Base del nombre de archivo (sin extensión ni fecha). */
  filenameBase: string;
  meta?: { label: string; value: string }[];
  table: ExportTable;
  footer?: string;
}

const NAVY: [number, number, number] = [30, 58, 95];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [90, 90, 100];

/**
 * Y3 — genera y comparte un ExportDoc como PDF (jsPDF, reusa el patrón de
 * pre-uso) o Excel (.xlsx real vía `write-excel-file`, cargado bajo demanda para
 * no engordar el bundle inicial). Todo local → funciona 100% offline. El envío
 * usa el Share nativo de Capacitor (el usuario elige WhatsApp u otra app) o la
 * Web Share API en la PWA, con descarga como último recurso.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  /** Comparte el documento en el formato elegido. */
  async share(doc: ExportDoc, format: ExportFormat): Promise<{ ok: boolean; fallback: boolean }> {
    const { blob, filename, mime } = await this.render(doc, format);
    return this.shareBlob(blob, filename, mime, doc.title);
  }

  /** Descarga/guarda el documento localmente. */
  async download(doc: ExportDoc, format: ExportFormat): Promise<void> {
    const { blob, filename } = await this.render(doc, format);
    if (Capacitor.isNativePlatform()) {
      const base64 = await this.blobToBase64(blob);
      const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
      await Share.share({ title: doc.title, url: written.uri }).catch(() => {});
      return;
    }
    this.triggerDownload(blob, filename);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private async render(
    doc: ExportDoc,
    format: ExportFormat,
  ): Promise<{ blob: Blob; filename: string; mime: string }> {
    const stamp = this.stamp();
    const base = (doc.filenameBase || 'reporte').replace(/[^a-z0-9-]/gi, '') || 'reporte';
    if (format === 'excel') {
      return {
        blob: await this.buildExcel(doc),
        filename: `${base}-${stamp}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return { blob: this.buildPdf(doc).output('blob'), filename: `${base}-${stamp}.pdf`, mime: 'application/pdf' };
  }

  // ─── PDF ─────────────────────────────────────────────────────────────────

  private buildPdf(doc: ExportDoc): jsPDF {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 15;

    // Header
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, W, 26, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(doc.title.toUpperCase(), M, 13);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Constructora SD', M, 20);

    let y = 34;

    // Meta
    if (doc.meta?.length) {
      pdf.setFontSize(10);
      for (const m of doc.meta) {
        pdf.setTextColor(...MUTED);
        pdf.setFont('helvetica', 'normal');
        pdf.text(m.label, M, y);
        pdf.setTextColor(...INK);
        pdf.setFont('helvetica', 'bold');
        pdf.text(pdf.splitTextToSize(m.value || '—', W - M - 50), 50, y);
        y += 6.5;
      }
      y += 3;
    }

    // Table
    const cols = doc.table.columns;
    const weights = doc.table.colWeights?.length === cols.length ? doc.table.colWeights : cols.map(() => 1);
    const totalW = W - 2 * M;
    const wsum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / wsum) * totalW);
    const xs: number[] = [];
    let acc = M;
    for (const w of widths) {
      xs.push(acc);
      acc += w;
    }

    const drawHeader = (): void => {
      pdf.setFillColor(238, 238, 238);
      pdf.rect(M, y - 5, totalW, 8, 'F');
      pdf.setTextColor(...INK);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      cols.forEach((c, i) => pdf.text(pdf.splitTextToSize(c, widths[i] - 3), xs[i] + 1.5, y));
      y += 6;
    };
    drawHeader();

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    for (const row of doc.table.rows) {
      const cells = cols.map((_, i) => pdf.splitTextToSize(String(row[i] ?? ''), widths[i] - 3) as string[]);
      const lines = Math.max(1, ...cells.map((c) => c.length));
      const rowH = lines * 4.6 + 2;
      if (y + rowH > H - 14) {
        pdf.addPage();
        y = 20;
        drawHeader();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
      }
      pdf.setTextColor(...INK);
      cells.forEach((c, i) => pdf.text(c, xs[i] + 1.5, y));
      y += rowH;
      pdf.setDrawColor(230);
      pdf.line(M, y - 3.5, W - M, y - 3.5);
    }

    if (doc.footer) {
      y += 4;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(doc.footer, totalW), M, y);
    }

    return pdf;
  }

  // ─── Excel ───────────────────────────────────────────────────────────────

  private async buildExcel(doc: ExportDoc): Promise<Blob> {
    // Carga bajo demanda: el chunk queda fuera del bundle inicial (offline OK: el
    // SW lo precachea en la PWA y en el APK va empaquetado). Tipamos la firma de
    // forma laxa (array-of-arrays de celdas → Blob en el navegador).
    const writeXlsxFile = (await import('write-excel-file/browser')).default as unknown as (
      rows: unknown,
      opts?: unknown,
    ) => Promise<Blob>;

    type Cell = { value: string | number | null; fontWeight?: 'bold'; type?: unknown; backgroundColor?: string; span?: number };
    const rows: (Cell | null)[][] = [];
    const ncols = doc.table.columns.length;
    const pad = (r: (Cell | null)[]): (Cell | null)[] =>
      r.length >= ncols ? r : [...r, ...Array(ncols - r.length).fill(null)];

    rows.push(pad([{ value: doc.title, fontWeight: 'bold' }]));
    for (const m of doc.meta ?? []) rows.push(pad([{ value: m.label, fontWeight: 'bold' }, { value: m.value }]));
    rows.push(pad([]));
    rows.push(doc.table.columns.map((c) => ({ value: c, fontWeight: 'bold', backgroundColor: '#EEEEEE' })));
    for (const row of doc.table.rows) {
      rows.push(
        doc.table.columns.map((_, i) => {
          const v = row[i];
          return typeof v === 'number' ? { value: v, type: Number } : { value: v == null ? '' : String(v), type: String };
        }),
      );
    }
    if (doc.footer) {
      rows.push(pad([]));
      rows.push(pad([{ value: doc.footer, fontWeight: 'bold' }]));
    }

    // En el navegador/WebView, writeXlsxFile devuelve un Blob (sin filePath).
    return await writeXlsxFile(rows, {});
  }

  // ─── Compartir un Blob (nativo / PWA) ────────────────────────────────────

  private async shareBlob(
    blob: Blob,
    filename: string,
    mime: string,
    title: string,
  ): Promise<{ ok: boolean; fallback: boolean }> {
    if (Capacitor.isNativePlatform()) {
      try {
        const base64 = await this.blobToBase64(blob);
        const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        await Share.share({ title, url: written.uri });
        return { ok: true, fallback: false };
      } catch {
        // cancelar la hoja de compartir rechaza la promesa: no-op benigno.
        return { ok: false, fallback: false };
      }
    }

    const file = new File([blob], filename, { type: mime });
    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
      share?: (d: { files: File[]; title?: string }) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title });
        return { ok: true, fallback: false };
      } catch {
        /* cancelado o no soportado → descarga */
      }
    }
    this.triggerDownload(blob, filename);
    return { ok: true, fallback: true };
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.readAsDataURL(blob);
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}
