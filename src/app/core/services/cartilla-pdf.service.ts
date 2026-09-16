import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CartillaDetalle } from '../../shared/models/cartilla.model';
import { formatFecha } from '../util/fecha';

/**
 * BO10 — PDF de una cartilla de acero para compartir por WhatsApp (mismo criterio
 * que ConducePdfService/OrdenTrabajoPdfService: jsPDF + share sheet nativo, o
 * navigator.share / descarga en web). Encabezado + obra/fecha + atados/piezas +
 * kg por diámetro.
 */
@Injectable({ providedIn: 'root' })
export class CartillaPdfService {
  private readonly M = 14;
  private readonly PW = 210;
  private readonly PH = 297;

  async generar(c: CartillaDetalle): Promise<void> {
    const filename = `cartilla-${(c.folio || c.id).replace(/[^\w-]/g, '')}.pdf`;
    if (Capacitor.isNativePlatform()) {
      const doc = this.build(c);
      const base64 = this.stripDataUrl(doc.output('datauristring'));
      const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      await Share.share({ title: 'Cartilla de acero', text: c.folio, url: w.uri, dialogTitle: 'Compartir cartilla' });
      return;
    }
    const blob = this.build(c).output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    const navAny = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (navAny.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: 'Cartilla de acero' } as ShareData);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private build(c: CartillaDetalle): jsPDF {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = this.M;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text('Constructora Scheker & Domínguez', this.M, y);
    y += 7;
    doc.setFontSize(15);
    doc.text(`Cartilla de acero ${c.folio}`, this.M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(`Fecha: ${formatFecha(c.fecha)}`, this.PW - this.M, this.M, { align: 'right' });
    if (c.es_prueba) {
      doc.setTextColor(180, 60, 60);
      doc.text('· PRUEBA ·', this.PW - this.M, this.M + 5, { align: 'right' });
      doc.setTextColor(110);
    }
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text(`Obra: ${c.proyecto_nombre || '—'}`, this.M, y);
    y += 5;
    if (c.ingeniero_nombre) {
      doc.text(`Ingeniero: ${c.ingeniero_nombre}`, this.M, y);
      y += 5;
    }
    doc.text(`Peso total: ${this.num(c.peso_total_kg ?? 0)} kg`, this.M, y);
    y += 8;

    for (const a of c.atados) {
      y = this.ensurePage(doc, y, 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${a.identificador || 'Atado'}${a.elemento ? ' · ' + a.elemento : ''}`, this.M, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      for (const p of a.piezas) {
        y = this.ensurePage(doc, y, 6);
        const tramos = (p.tramos_cm ?? []).map((t) => `${t.lado ? t.lado + ':' : ''}${t.cm}`).join(' · ');
        const linea = `  ${p.marca || 'Pieza'} · Ø${p.diametro_codigo} · ${p.figura_codigo} · ${tramos} cm · ${p.cantidad} u · ${this.num(p.peso_kg ?? 0)} kg`;
        doc.text(doc.splitTextToSize(linea, this.PW - 2 * this.M), this.M, y);
        y += 5;
      }
      y += 3;
    }

    return doc;
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
}
