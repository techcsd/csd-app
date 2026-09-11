import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { OrdenTrabajoDetalle } from '../models/bitacora.model';
import { formatFecha, formatFechaHumana } from '../util/fecha';

/**
 * BN1 — PDF de la orden de trabajo, mismo criterio que ConducePdfService (jsPDF
 * self-contained, sin CDN): encabezado + datos + trabajo solicitado + las DOS
 * firmas (ingeniero/cliente). Comparte por el share sheet nativo (→ WhatsApp) o
 * descarga. Las firmas se embeben si hay red; si fallan, el PDF sale igual.
 */
@Injectable({ providedIn: 'root' })
export class OrdenTrabajoPdfService {
  private readonly M = 14; // margen mm
  private readonly PW = 210; // A4 width mm
  private readonly PH = 297; // A4 height mm

  async build(o: OrdenTrabajoDetalle): Promise<jsPDF> {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const b = o.bitacora;
    const d = o.detalle;
    let y = this.M;

    // ── Encabezado ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Constructora Scheker & Domínguez', this.M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y += 6;
    doc.text('Orden de Trabajo', this.M, y);
    // Meta a la derecha
    doc.setFontSize(9);
    doc.text(`Fecha: ${formatFecha(b.fecha)}`, this.PW - this.M, this.M, { align: 'right' });
    if (b.created_at) {
      doc.text(`Registro: ${formatFechaHumana(b.created_at)}`, this.PW - this.M, this.M + 5, { align: 'right' });
    }
    y += 3;
    doc.setLineWidth(0.5);
    doc.line(this.M, y, this.PW - this.M, y);
    y += 7;

    if (b.es_prueba) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(180, 60, 0);
      doc.text('· PRUEBA ·', this.M, y);
      doc.setTextColor(20);
      y += 6;
    }

    // ── Info (2 columnas) ──
    const rows: [string, string][] = [
      ['Obra', b.proyecto || '—'],
      ['Lo pidió', d?.solicitado_por || '—'],
      ['Ubicación', d?.ubicacion || '—'],
      ['Cantidad', d?.cantidad != null ? `${this.num(d.cantidad)}${d.unidad ? ' ' + d.unidad : ''}` : '—'],
      ['Monto estimado', d?.monto_estimado != null ? this.num(d.monto_estimado) : '—'],
      ['Registrada por', b.autor || '—'],
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

    // ── Trabajo solicitado ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Trabajo solicitado', this.M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const desc = doc.splitTextToSize(d?.descripcion || '—', this.PW - this.M * 2);
    doc.text(desc, this.M, y);
    y += desc.length * 5 + 4;

    // ── Comentarios ──
    if (b.comentarios) {
      y = this.ensurePage(doc, y, 20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Comentarios', this.M, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(b.comentarios, this.PW - this.M * 2);
      doc.text(lines, this.M, y);
      y += lines.length * 4 + 4;
    }

    // ── Firmas (ingeniero + cliente) ──
    y = this.ensurePage(doc, y, 44);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Firmas', this.M, y);
    y += 4;
    const firmaY = y;
    const firmaW = 70;
    let fx = this.M;
    const orden = ['ingeniero', 'cliente'];
    const firmas = [...o.firmas].sort((a, b2) => orden.indexOf(a.rol) - orden.indexOf(b2.rol)).slice(0, 2);
    for (const f of firmas) {
      const img = await this.toDataUrl(f.firma_url);
      if (img) {
        try {
          doc.addImage(img, 'PNG', fx, firmaY, firmaW, 24);
        } catch {
          /* imagen no embebible → solo la línea */
        }
      }
      doc.setLineWidth(0.3);
      doc.line(fx, firmaY + 26, fx + firmaW, firmaY + 26);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(f.rol === 'ingeniero' ? 'Ingeniero' : 'Cliente', fx, firmaY + 31);
      doc.setFont('helvetica', 'normal');
      doc.text(f.nombre || '—', fx, firmaY + 35);
      if (f.cedula) doc.text(f.cedula, fx, firmaY + 39);
      if (f.rol_desc) doc.text(f.rol_desc, fx, firmaY + (f.cedula ? 43 : 39));
      fx += firmaW + 12;
    }

    return doc;
  }

  async blob(o: OrdenTrabajoDetalle): Promise<Blob> {
    const doc = await this.build(o);
    return doc.output('blob');
  }

  /** Compartir por el share sheet nativo (→ WhatsApp). Web: navigator.share o descarga. */
  async compartir(o: OrdenTrabajoDetalle): Promise<void> {
    const filename = this.filename(o);
    if (Capacitor.isNativePlatform()) {
      const doc = await this.build(o);
      const base64 = this.stripDataUrl(doc.output('datauristring'));
      const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      await Share.share({ title: 'Orden de trabajo', text: 'Orden de trabajo', url: w.uri, dialogTitle: 'Compartir orden' });
      return;
    }
    const blob = await this.blob(o);
    const file = new File([blob], filename, { type: 'application/pdf' });
    const navAny = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (navAny.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: 'Orden de trabajo' } as ShareData);
      return;
    }
    this.webDownload(blob, filename);
  }

  /** Descargar/guardar. Native: Documents; Web: descarga del navegador. */
  async descargar(o: OrdenTrabajoDetalle): Promise<string> {
    const filename = this.filename(o);
    if (Capacitor.isNativePlatform()) {
      const doc = await this.build(o);
      const base64 = this.stripDataUrl(doc.output('datauristring'));
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
      return `Documentos/${filename}`;
    }
    const blob = await this.blob(o);
    this.webDownload(blob, filename);
    return filename;
  }

  private filename(o: OrdenTrabajoDetalle): string {
    return `orden-trabajo-${(o.bitacora.id || '').slice(0, 8)}.pdf`;
  }

  // ── Helpers de dibujo (mismos que ConducePdfService) ──
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
