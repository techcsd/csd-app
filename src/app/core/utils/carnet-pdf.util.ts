// CE5 — PDF del carnet de personal de obra a tamaño CR80 REAL (85.60 × 53.98 mm),
// frente y dorso (una página por cara). Espeja el diseño de la web (navy + logo
// blanco + QR) pero generado con jsPDF para poder COMPARTIRLO desde el teléfono
// (share-sheet) e imprimirlo a escala 100 %. El QR usa la MISMA URL pública de
// verificación que la web (`/verificar/<carnet>`).
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { PersonalObra, NACIONALIDAD_LABEL } from '../models/personal-obra.model';

const NAVY: [number, number, number] = [30, 58, 95];
const AMBER: [number, number, number] = [248, 178, 74];
const ORANGE: [number, number, number] = [249, 115, 22];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [120, 120, 130];

const CARD_W = 85.6;
const CARD_H = 53.98;

/** Descarga un asset/URL y lo devuelve como data URL (para jsPDF.addImage). */
async function toDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('read'));
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Iniciales (máx. 2) a partir del nombre + apellido. */
function iniciales(p: PersonalObra): string {
  const parts = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '').concat(parts[1]?.[0] ?? '').toUpperCase() || '—';
}

export interface CarnetPdfOpts {
  /** URL (firmada) de la foto de la persona; si falta, se dibujan iniciales. */
  fotoUrl?: string | null;
  /** URL pública de verificación (QR). `${origin}/verificar/<carnet>`. */
  verifyUrl: string;
  /** Ruta del logo blanco (asset). */
  logoUrl?: string;
  /** Teléfono de Administración para el dorso. */
  telefono?: string;
}

/**
 * CE5 — genera el PDF CR80 (frente + dorso). Devuelve el Blob listo para
 * compartir/imprimir. Todo local (offline-friendly): jsPDF + qrcode en el bundle.
 */
export async function generarCarnetPdf(p: PersonalObra, opts: CarnetPdfOpts): Promise<Blob> {
  const telefono = opts.telefono?.trim() || '(809) 534-2240';
  const [logo, foto, qr] = await Promise.all([
    toDataUrl(opts.logoUrl ?? 'assets/imgs/logos/csd-no-bg-logo-white.png'),
    toDataUrl(opts.fotoUrl),
    QRCode.toDataURL(opts.verifyUrl, { width: 300, margin: 0 }).catch(() => null),
  ]);

  const pdf = new jsPDF({ unit: 'mm', format: [CARD_W, CARD_H], orientation: 'landscape' });

  // ───────── FRENTE ─────────
  // Cabecera navy
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, CARD_W, 12, 'F');
  if (logo) {
    try { pdf.addImage(logo, 'PNG', 3, 2.6, 7, 7); } catch { /* sin logo */ }
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('CONSTRUCTORA SD', 12, 5.6);
  pdf.setTextColor(...AMBER);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(5.5);
  pdf.text('CARNET DE PERSONAL DE OBRA', 12, 9.2);

  // Foto / iniciales (3:4)
  const fx = 3, fy = 15, fw = 18, fh = 24;
  if (foto) {
    try {
      pdf.addImage(foto, 'JPEG', fx, fy, fw, fh);
    } catch {
      drawIniciales(pdf, p, fx, fy, fw, fh);
    }
  } else {
    drawIniciales(pdf, p, fx, fy, fw, fh);
  }

  // Datos
  const ix = 24;
  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  const nombre = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();
  pdf.text(pdf.splitTextToSize(nombre, CARD_W - ix - 3), ix, 19);

  const row = (label: string, value: string, y: number): void => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(...MUTED);
    pdf.text(label, ix, y);
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.text(pdf.splitTextToSize(value || '—', CARD_W - ix - 3), ix + 15, y);
  };
  const cargo = p.cargo ? `${p.cargo.nombre} · ${p.cargo.codigo}` : '—';
  row('Cargo:', cargo, 25.5);
  row('Obra:', p.proyecto?.nombre ?? '—', 30);
  row('Nacionalidad:', NACIONALIDAD_LABEL[p.nacionalidad] ?? p.nacionalidad, 34.5);
  row('Documento:', p.documento_numero ?? '—', 39);

  // Pie: número de carnet + QR
  pdf.setTextColor(...ORANGE);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text(p.carnet_numero ?? 'SIN CARNET', 3, 49);
  pdf.setTextColor(...MUTED);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(4.6);
  pdf.text('Verifica escaneando el código', 3, 52);
  if (qr) {
    try { pdf.addImage(qr, 'PNG', CARD_W - 17, 38, 14, 14); } catch { /* sin QR */ }
  }

  // ───────── DORSO ─────────
  pdf.addPage([CARD_W, CARD_H], 'landscape');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, CARD_W, CARD_H, 'F');
  if (qr) {
    try { pdf.addImage(qr, 'PNG', (CARD_W - 24) / 2, 6, 24, 24); } catch { /* sin QR */ }
  }
  pdf.setTextColor(...ORANGE);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text(p.carnet_numero ?? '', CARD_W / 2, 35, { align: 'center' });
  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(5.4);
  pdf.text(
    pdf.splitTextToSize(
      `Este carnet es propiedad de Constructora SD. Si lo encuentras, llama al ${telefono}.`,
      CARD_W - 12,
    ),
    CARD_W / 2,
    41,
    { align: 'center' },
  );
  pdf.setTextColor(...MUTED);
  pdf.setFontSize(5);
  pdf.text('Válido mientras el portador esté activo en la obra.', CARD_W / 2, 49, { align: 'center' });

  return pdf.output('blob');
}

function drawIniciales(pdf: jsPDF, p: PersonalObra, x: number, y: number, w: number, h: number): void {
  pdf.setFillColor(...NAVY);
  pdf.rect(x, y, w, h, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(iniciales(p), x + w / 2, y + h / 2 + 3.5, { align: 'center' });
}
