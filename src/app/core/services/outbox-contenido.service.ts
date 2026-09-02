import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import { db, OutboxOp } from '../db/app-db';
import { SyncService } from '../sync/sync.service';
import { BorradorService } from './borrador.service';
import { BitacoraService } from './bitacora.service';
import { campoLabel, tipoOpLabel } from '../util/outbox-labels';

/** BG3 — una fila legible del contenido (campo → valor). */
export interface ContenidoFila {
  label: string;
  valor: string;
}
/** BG3 — una sección del contenido (cabecera + filas). */
export interface ContenidoSeccion {
  titulo: string;
  filas: ContenidoFila[];
}
/** BG3 — el contenido completo de un pendiente para la vista de solo-lectura. */
export interface OutboxContenido {
  tipoLabel: string;
  secciones: ContenidoSeccion[];
  fotos: Array<{ url: string; nombre: string }>;
  audios: number;
}

// Claves internas que no se muestran como "campo" (ids, slots de fotos/audio…).
const OCULTAS = new Set(['id', 'capturado_en']);
const esSlot = (k: string): boolean => /_slot$|_slots$/.test(k);

/**
 * BG3 — leer el CONTENIDO de un pendiente atascado (para replicarlo si hace
 * falta), duplicarlo a un borrador nuevo (bitácora), y exportarlo (texto + fotos)
 * como último recurso. La data real de obra sigue en el teléfono aunque el envío
 * falle; esto la hace visible, reutilizable y compartible — nunca se pierde.
 */
@Injectable({ providedIn: 'root' })
export class OutboxContenidoService {
  private sync = inject(SyncService);
  private borrador = inject(BorradorService);
  private bitacora = inject(BitacoraService);

  // ── Ver contenido ──────────────────────────────────────────────────────────

  /** Modelo legible del payload + las fotos reconstruidas (object URLs). El caller
   *  debe revocar las URLs al cerrar (revokeFotos). */
  async contenido(op: OutboxOp): Promise<OutboxContenido> {
    const obras = await this.mapaObras();
    const p = op.payload ?? {};
    const secciones: ContenidoSeccion[] = [];

    // Sección principal: campos escalares del payload.
    const principales: ContenidoFila[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (OCULTAS.has(k) || esSlot(k)) continue;
      if (Array.isArray(v) || (v && typeof v === 'object')) continue;
      const valor = this.formatValor(k, v, obras);
      if (valor === '') continue;
      principales.push({ label: campoLabel(k), valor });
    }
    if (principales.length) secciones.push({ titulo: 'Datos', filas: principales });

    // Sub-secciones para los arreglos conocidos (actividades / restricciones / equipos / items).
    this.seccionActividades(p['actividades'], secciones);
    this.seccionRestricciones(p['restricciones'], secciones);
    this.seccionEquipos(p['equipos_alquilados'], secciones);
    this.seccionItems(p['items'], secciones);

    // Fotos (imágenes) + conteo de notas de voz.
    const blobs = await this.sync.getOpFotos(op.id);
    const fotos: Array<{ url: string; nombre: string }> = [];
    let audios = 0;
    blobs.forEach((f, i) => {
      const esAudio = /^restraudio_|^voz_/.test(f.slot) || (f.blob.type || '').startsWith('audio');
      if (esAudio) {
        audios++;
        return;
      }
      fotos.push({ url: URL.createObjectURL(f.blob), nombre: `Foto ${i + 1}` });
    });

    return { tipoLabel: tipoOpLabel(op.tipo_op), secciones, fotos, audios };
  }

  /** Revoca las object URLs de las fotos de un contenido (al cerrar la vista). */
  revokeFotos(c: OutboxContenido | null): void {
    for (const f of c?.fotos ?? []) URL.revokeObjectURL(f.url);
  }

  // ── Duplicar a nueva bitácora ────────────────────────────────────────────────

  /** ¿Este pendiente se puede duplicar a un borrador nuevo? (parte diario de bitácora) */
  puedeDuplicar(op: OutboxOp): boolean {
    return op.tipo_op === 'bitacora' && op.payload?.['tipo'] === 'parte_diario';
  }

  /**
   * BG3 — crea un borrador NUEVO pre-llenado con TODO el contenido del pendiente
   * (fotos principales incluidas, copiadas a `borrador_fotos`), sin re-teclear
   * nada. El pendiente original queda INTACTO (por si el reintento post-fix es la
   * mejor vía). Devuelve la ruta para abrir el wizard con ese borrador.
   */
  async duplicarBitacora(op: OutboxOp): Promise<string> {
    const p = op.payload ?? {};
    const draftKey = `parte_diario:${crypto.randomUUID()}`;

    const restricciones = Array.isArray(p['restricciones'])
      ? (p['restricciones'] as Array<Record<string, unknown>>)
      : [];
    const restriccionDesc: Record<string, string> = {};
    for (const r of restricciones) {
      const tipo = String(r['tipo_restriccion'] ?? '');
      const desc = r['descripcion_otro'];
      if (tipo && tipo !== 'NINGUNA' && desc != null) restriccionDesc[tipo] = String(desc);
    }
    const equipos = Array.isArray(p['equipos_alquilados'])
      ? (p['equipos_alquilados'] as Array<Record<string, unknown>>)
      : [];
    const migracion = p['migracion_obreros'];

    const draft = {
      proyectoId: String(p['proyecto_id'] ?? ''),
      llovio: (p['llovio'] as boolean | null) ?? null,
      lluviaDetalle: String(p['lluvia_detalle'] ?? ''),
      horasLluvia: Number(p['horas_lluvia'] ?? 0) || 0,
      sinActividad: !!p['sin_actividad'],
      motivoSinActividad: (p['motivo_sin_actividad'] as string | null) ?? null,
      motivoDetalle: String(p['motivo_sin_actividad_detalle'] ?? ''),
      huboMigracion: (p['hubo_migracion'] as boolean | null) ?? null,
      migracionObreros: '',
      migracionObrerosCount: Array.isArray(migracion) ? migracion.length : 0,
      carpinteria: Number(p['personal_carpinteria'] ?? 0) || 0,
      acero: Number(p['personal_acero'] ?? 0) || 0,
      casa: Number(p['trabajadores_casa'] ?? 0) || 0,
      otroPersonal: String(p['otro_personal'] ?? ''),
      ingenieroResponsable: String(p['ingeniero_responsable'] ?? ''),
      horaFinTrabajo: String(p['hora_fin_trabajo'] ?? ''),
      actividades: Array.isArray(p['actividades'])
        ? (p['actividades'] as Array<Record<string, unknown>>).map((a) => ({
            estructura: String(a['estructura'] ?? ''),
            actividad: String(a['actividad'] ?? ''),
            cantidad: a['cantidad'] == null ? null : Number(a['cantidad']),
            unidad: (a['unidad'] as string | null) ?? null,
            bloque: (a['bloque'] as string | null) ?? null,
            es_aproximada: !!a['es_aproximada'],
          }))
        : [],
      restricciones: restricciones.map((r) => String(r['tipo_restriccion'] ?? '')).filter(Boolean),
      restriccionDesc,
      huboEquipos: !!p['hubo_equipos'],
      hayRetirar: equipos.some((e) => !!e['para_retirar']),
      hayDanados: equipos.some((e) => !!e['danado']),
      equiposAlquilados: equipos.map((e) => ({
        equipo: String(e['equipo'] ?? ''),
        uso: String(e['uso'] ?? ''),
        proveedor: String(e['proveedor'] ?? ''),
        para_retirar: !!e['para_retirar'],
        danado: !!e['danado'],
        dano_detalle: String(e['dano_detalle'] ?? ''),
      })),
      comentarios: String(p['comentarios'] ?? ''),
      step: 1, // empezar del inicio para que el usuario revise y reenvíe
    };

    const obras = await this.mapaObras();
    const nombreObra = obras.get(draft.proyectoId) ?? '';
    await this.borrador.save(draftKey, draft, {
      tipo: 'parte',
      etiqueta: 'Bitácora (copia)' + (nombreObra ? ' · ' + nombreObra : ''),
      ruta: '/bitacora/parte',
    });

    // Copia las fotos PRINCIPALES (slots foto_*) al borrador para que el wizard las
    // rehidrate — sin re-tomarlas. Las de restricción/equipo (por índice) se retoman.
    const fotos = await db.fotos_pendientes.where('op_id').equals(op.id).toArray();
    for (const f of fotos) {
      if (!/^foto_\d+/.test(f.slot)) continue;
      const blob = f.data ? new Blob([f.data], { type: f.type || 'image/jpeg' }) : f.blob;
      if (blob) await this.borrador.saveFoto(draftKey, f.slot, blob);
    }

    return `/bitacora/parte?borrador=${encodeURIComponent(draftKey)}`;
  }

  // ── Exportar / compartir (texto + fotos) ─────────────────────────────────────

  /**
   * BG3 — último recurso: empaqueta el contenido (texto + fotos) en un PDF y lo
   * comparte (WhatsApp u otra app). Un solo archivo → llega completo aunque el
   * envío al sistema falle. 100% local/offline.
   */
  async exportar(op: OutboxOp): Promise<{ ok: boolean; fallback: boolean }> {
    const c = await this.contenido(op);
    try {
      const pdf = await this.buildPdf(op, c);
      const blob = pdf.output('blob');
      const filename = `${op.tipo_op}-${op.capturado_en.slice(0, 10)}.pdf`;
      return await this.shareBlob(blob, filename, 'application/pdf', c.tipoLabel);
    } finally {
      this.revokeFotos(c);
    }
  }

  private async buildPdf(op: OutboxOp, c: OutboxContenido): Promise<jsPDF> {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 15;
    let y = 14;

    pdf.setFillColor(30, 58, 95);
    pdf.rect(0, 0, W, 22, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text(c.tipoLabel.toUpperCase(), M, 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Constructora SD · pendiente no enviado', M, 17);
    y = 30;

    const ensure = (h: number): void => {
      if (y + h > H - 12) {
        pdf.addPage();
        y = 18;
      }
    };

    for (const sec of c.secciones) {
      ensure(10);
      pdf.setTextColor(30, 58, 95);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(sec.titulo, M, y);
      y += 6;
      pdf.setTextColor(24, 24, 27);
      pdf.setFontSize(9.5);
      for (const f of sec.filas) {
        const lines = pdf.splitTextToSize(`${f.label}: ${f.valor}`, W - 2 * M) as string[];
        ensure(lines.length * 4.6 + 1);
        pdf.setFont('helvetica', 'normal');
        pdf.text(lines, M, y);
        y += lines.length * 4.6 + 1;
      }
      y += 3;
    }

    if (c.fotos.length) {
      ensure(10);
      pdf.setTextColor(30, 58, 95);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(`Fotos (${c.fotos.length})`, M, y);
      y += 6;
      const cellW = (W - 2 * M - 6) / 2;
      const cellH = cellW * 0.75;
      let col = 0;
      for (const foto of c.fotos) {
        const dataUrl = await this.toDataUrl(foto.url);
        if (!dataUrl) continue;
        ensure(cellH + 4);
        const x = M + col * (cellW + 6);
        try {
          pdf.addImage(dataUrl, 'JPEG', x, y, cellW, cellH);
        } catch {
          /* imagen ilegible: se omite */
        }
        col++;
        if (col === 2) {
          col = 0;
          y += cellH + 4;
        }
      }
      if (col === 1) y += cellH + 4;
    }

    return pdf;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private obrasCache: Map<string, string> | null = null;
  private async mapaObras(): Promise<Map<string, string>> {
    if (this.obrasCache) return this.obrasCache;
    const m = new Map<string, string>();
    try {
      for (const p of await this.bitacora.getProyectos()) m.set(p.id, p.nombre);
    } catch {
      /* offline sin caché → se muestran ids */
    }
    this.obrasCache = m;
    return m;
  }

  private formatValor(k: string, v: unknown, obras: Map<string, string>): string {
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (k === 'proyecto_id') return obras.get(String(v)) ?? String(v);
    return String(v);
  }

  private seccionActividades(v: unknown, out: ContenidoSeccion[]): void {
    if (!Array.isArray(v) || !v.length) return;
    const filas: ContenidoFila[] = [];
    for (const a of v as Array<Record<string, unknown>>) {
      const partes = [a['bloque'], a['estructura'], a['actividad']].filter(Boolean).join(' · ');
      const cant = a['cantidad'] != null ? ` — ${a['cantidad']}${a['unidad'] ? ' ' + a['unidad'] : ''}` : '';
      filas.push({ label: '•', valor: `${partes}${cant}` });
    }
    out.push({ titulo: 'Trabajo realizado', filas });
  }

  private seccionRestricciones(v: unknown, out: ContenidoSeccion[]): void {
    if (!Array.isArray(v) || !v.length) return;
    const filas: ContenidoFila[] = [];
    for (const r of v as Array<Record<string, unknown>>) {
      const tipo = String(r['tipo_restriccion'] ?? '');
      if (!tipo) continue;
      filas.push({ label: tipo, valor: String(r['descripcion_otro'] ?? '') || '—' });
    }
    if (filas.length) out.push({ titulo: 'Restricciones', filas });
  }

  private seccionEquipos(v: unknown, out: ContenidoSeccion[]): void {
    if (!Array.isArray(v) || !v.length) return;
    const filas: ContenidoFila[] = [];
    for (const e of v as Array<Record<string, unknown>>) {
      const flags = [e['para_retirar'] ? 'retirar' : '', e['danado'] ? 'dañado' : ''].filter(Boolean).join(', ');
      const detalle = [e['uso'], e['proveedor'], e['dano_detalle'], flags].filter(Boolean).join(' · ');
      filas.push({ label: String(e['equipo'] ?? 'Equipo'), valor: detalle || '—' });
    }
    out.push({ titulo: 'Equipos', filas });
  }

  private seccionItems(v: unknown, out: ContenidoSeccion[]): void {
    if (!Array.isArray(v) || !v.length) return;
    const filas: ContenidoFila[] = [];
    for (const it of v as Array<Record<string, unknown>>) {
      const cant = it['cantidad'] != null ? ` — ${it['cantidad']}${it['unidad'] ? ' ' + it['unidad'] : ''}` : '';
      filas.push({ label: '•', valor: `${String(it['descripcion'] ?? 'Artículo')}${cant}` });
    }
    out.push({ titulo: 'Artículos', filas });
  }

  private async toDataUrl(objectUrl: string): Promise<string | null> {
    try {
      const blob = await (await fetch(objectUrl)).blob();
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
        /* cancelado → descarga */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
}
