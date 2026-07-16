import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import { formatFecha, formatFechaMedia } from '../util/fecha';
import { ChecklistResultado } from '../models/checklist-preuso.model';

export interface ReportHallazgo {
  numero: string | null;
  seccion: string;
  etiqueta: string;
  es_critico: boolean;
  comentario: string | null;
}

export interface ReportFoto {
  label: string;
  dataUrl: string; // JPEG data URL
}

/** Everything the pre-use PDF needs (already resolved by the page). */
export interface PreusoReportData {
  placa: string;
  vehiculo: string;
  tipoVehiculo: string;
  conductor: string;
  licenciaTipo: string | null;
  licenciaNumero: string | null;
  licenciaVencimiento: string | null;
  fecha: string; // ISO
  km: number | null;
  nivelCombustible: string | null;
  resultado: ChecklistResultado;
  estadoMantenimiento: 'ok' | 'pre_cita' | 'vencido';
  proximoMantenimientoKm: number | null;
  faltanMantenimientoKm: number | null;
  totalItems: number;
  respondidos: number;
  hallazgos: ReportHallazgo[];
  fotos: ReportFoto[];
}

const RESULTADO_META: Record<ChecklistResultado, { label: string; rgb: [number, number, number] }> = {
  aprobado: { label: 'APROBADO', rgb: [22, 163, 74] },
  con_hallazgos: { label: 'APROBADO CON HALLAZGOS', rgb: [217, 119, 6] },
  bloqueado: { label: 'VEHÍCULO BLOQUEADO', rgb: [220, 38, 38] },
};

const NAVY: [number, number, number] = [30, 58, 95];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [90, 90, 100];
const CRIT: [number, number, number] = [220, 38, 38];

/**
 * Builds the pre-use inspection report as a PDF (jsPDF), matching the boss's
 * prototype: dark header, driver/vehicle data, coloured RESULT band, findings,
 * and a photo-evidence page. Shares it via the native share sheet (Android) or
 * the Web Share API (PWA), falling back to a plain download.
 */
@Injectable({ providedIn: 'root' })
export class PreusoReportService {
  /** Share the report (WhatsApp etc.). Falls back to download when needed. */
  async compartir(data: PreusoReportData): Promise<{ ok: boolean; fallback: boolean }> {
    const doc = this.build(data);
    const filename = this.filename(data);

    if (Capacitor.isNativePlatform()) {
      const base64 = doc.output('datauristring').split(',')[1];
      const written = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({
        title: 'Reporte de pre-uso',
        text: `Pre-uso ${data.placa} — ${RESULTADO_META[data.resultado].label}`,
        url: written.uri,
      });
      return { ok: true, fallback: false };
    }

    // PWA: Web Share API with the file when supported.
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
      share?: (d: { files: File[]; title?: string; text?: string }) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({
          files: [file],
          title: 'Reporte de pre-uso',
          text: `Pre-uso ${data.placa} — ${RESULTADO_META[data.resultado].label}`,
        });
        return { ok: true, fallback: false };
      } catch {
        // user cancelled or share failed → fall through to download
      }
    }
    this.triggerDownload(blob, filename);
    return { ok: true, fallback: true };
  }

  /** Download / save the report locally. */
  async descargar(data: PreusoReportData): Promise<void> {
    const doc = this.build(data);
    const filename = this.filename(data);
    if (Capacitor.isNativePlatform()) {
      const base64 = doc.output('datauristring').split(',')[1];
      const written = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
      });
      // Offer to open/share the saved file so the user can find it.
      await Share.share({ title: 'Reporte de pre-uso', url: written.uri }).catch(() => {});
      return;
    }
    this.triggerDownload(doc.output('blob'), filename);
  }

  private filename(data: PreusoReportData): string {
    const d = new Date(data.fecha);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const placa = data.placa.replace(/[^a-z0-9]/gi, '') || 'vehiculo';
    return `preuso-${placa}-${stamp}.pdf`;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  private build(data: PreusoReportData): jsPDF {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 15;
    const meta = RESULTADO_META[data.resultado];

    // ── Header ────────────────────────────────────────────────────────────
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('REPORTE DE PRE-USO', M, 14);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Constructora SD — Flota', M, 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(data.placa, W - M, 18, { align: 'right' });

    let y = 40;

    // ── Datos ─────────────────────────────────────────────────────────────
    const rows: Array<[string, string]> = [
      ['Chofer', data.conductor || '—'],
      [
        'Licencia',
        [
          data.licenciaTipo ? `Cat. ${data.licenciaTipo}` : null,
          data.licenciaNumero,
          data.licenciaVencimiento ? `vence ${fmtFecha(data.licenciaVencimiento)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—',
      ],
      ['Vehículo', `${data.vehiculo} (${data.tipoVehiculo})`],
      ['Fecha / hora', fmtFechaHora(data.fecha)],
      ['Kilometraje', data.km != null ? `${fmtNum(data.km)} km` : '—'],
      ['Combustible', data.nivelCombustible ?? '—'],
      ['Próximo mantenimiento', mantLinea(data)],
      ['Checklist', `${data.respondidos} de ${data.totalItems} puntos`],
    ];
    doc.setFontSize(11);
    for (const [label, value] of rows) {
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'normal');
      doc.text(label, M, y);
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'bold');
      doc.text(doc.splitTextToSize(value, W - M - 60), 60, y);
      y += 8;
    }

    // ── Result band ─────────────────────────────────────────────────────────
    y += 2;
    doc.setFillColor(...meta.rgb);
    doc.roundedRect(M, y, W - 2 * M, 14, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`RESULTADO: ${meta.label}`, W / 2, y + 9, { align: 'center' });
    y += 22;

    // ── Hallazgos ────────────────────────────────────────────────────────────
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Hallazgos', M, y);
    y += 7;
    doc.setFontSize(10);
    if (!data.hallazgos.length) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text('Sin hallazgos. Todos los puntos en orden.', M, y);
      y += 6;
    } else {
      for (const h of data.hallazgos) {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const num = h.numero ? `${h.numero}. ` : '• ';
        const critico = h.es_critico ? '  [CRÍTICO]' : '';
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...(h.es_critico ? CRIT : INK));
        const head = doc.splitTextToSize(`${num}${h.etiqueta}${critico}`, W - 2 * M);
        doc.text(head, M, y);
        y += head.length * 5;
        if (h.comentario) {
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(...MUTED);
          const c = doc.splitTextToSize(`“${h.comentario}”`, W - 2 * M - 4);
          doc.text(c, M + 4, y);
          y += c.length * 5;
        }
        y += 2;
      }
    }

    // ── Evidencia fotográfica ─────────────────────────────────────────────────
    if (data.fotos.length) {
      doc.addPage();
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('EVIDENCIA FOTOGRÁFICA', M, 12);

      const cols = 2;
      const gap = 6;
      const cellW = (W - 2 * M - gap) / cols;
      const cellH = cellW * 0.72;
      let px = M;
      let py = 26;
      for (const foto of data.fotos) {
        if (py + cellH + 8 > 285) {
          doc.addPage();
          py = 20;
          px = M;
        }
        try {
          doc.addImage(foto.dataUrl, 'JPEG', px, py, cellW, cellH);
        } catch {
          doc.setDrawColor(200);
          doc.rect(px, py, cellW, cellH);
        }
        doc.setTextColor(...MUTED);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(foto.label, px, py + cellH + 4);
        if (px + cellW + gap + cellW <= W - M) {
          px += cellW + gap;
        } else {
          px = M;
          py += cellH + 10;
        }
      }
    }

    return doc;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
// APP-012 (U9): sin Intl es-DO — en el WebView de Android pueden faltar los
// datos de locale y saldría formato en-US. Se usan los util es-DO hechos a mano
// (fecha.ts) para fechas y un separador de miles manual para números.
function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtFecha(iso: string): string {
  return formatFecha(iso);
}
function fmtFechaHora(iso: string): string {
  return formatFechaMedia(iso);
}
function mantLinea(data: PreusoReportData): string {
  if (data.proximoMantenimientoKm == null) return '—';
  const prox = `${fmtNum(data.proximoMantenimientoKm)} km`;
  if (data.estadoMantenimiento === 'vencido') {
    return `VENCIDO (${fmtNum(Math.abs(data.faltanMantenimientoKm ?? 0))} km pasados) — próx. ${prox}`;
  }
  if (data.estadoMantenimiento === 'pre_cita') {
    return `Pre-cita: faltan ${fmtNum(data.faltanMantenimientoKm ?? 0)} km — próx. ${prox}`;
  }
  return `Faltan ${fmtNum(data.faltanMantenimientoKm ?? 0)} km — próx. ${prox}`;
}
