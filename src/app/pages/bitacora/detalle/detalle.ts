import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { OrdenTrabajoPdfService } from '../../../core/services/orden-trabajo-pdf.service';
import { ToastService } from '../../../core/services/toast.service';
import { BitacoraFull, MOTIVOS_SIN_ACTIVIDAD, OrdenTrabajoDetalle } from '../../../core/models/bitacora.model';
import { formatFecha, formatFechaMedia, bitacoraRetrofechada } from '../../../core/util/fecha';

interface Media {
  url: string;
  audio: boolean;
  transcripcion: string | null; // AA22
  estado: string | null; // AA22 — pendiente|procesando|completada|fallida
}

/** Read-only detail of one of my bitácoras, with photos/audio. */
@Component({
  selector: 'app-bitacora-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, DecimalPipe],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class BitacoraDetallePage {
  private route = inject(ActivatedRoute);
  private bitacora = inject(BitacoraService);
  private location = inject(Location);
  private ordenPdf = inject(OrdenTrabajoPdfService);
  private toast = inject(ToastService);

  b = signal<BitacoraFull | null>(null);
  // BN1 — detalle + firmas de una orden de trabajo (solo cuando tipo=orden_trabajo).
  orden = signal<OrdenTrabajoDetalle | null>(null);
  pdfBusy = signal(false);
  media = signal<Media[]>([]);
  loading = signal(true);
  fmtFecha = formatFecha; // U9
  fmtFechaHora = formatFechaMedia; // APP-030 — created_at con hora local (sin corrimiento TZ)

  totalPersonal = computed(() => {
    const b = this.b();
    return b ? b.personal_carpinteria + b.personal_acero + b.trabajadores_casa : 0;
  });

  titulo = computed(() => {
    const t = this.b()?.tipo;
    // BN1 — la app pinta el título aunque no cree el tipo (igual que 'visita'). Sin
    // este caso una orden de trabajo se listaría con el default "Bitácora del día".
    return t === 'incidente'
      ? 'Incidente'
      : t === 'visita'
        ? 'Visita'
        : t === 'orden_trabajo'
          ? 'Orden de trabajo'
          : 'Bitácora del día';
  });

  /** BL9 — la bitácora documenta un día distinto al de su registro (retrofechada). */
  esDeOtraFecha = computed(() => {
    const b = this.b();
    return b ? bitacoraRetrofechada(b.fecha, b.created_at) : false;
  });

  /** Z4 — etiqueta legible del motivo "no se trabajó". */
  motivoLabel(v: string | null | undefined): string {
    return MOTIVOS_SIN_ACTIVIDAD.find((m) => m.value === v)?.label ?? v ?? '—';
  }

  /** U13 — obreros afectados por migración (jsonb → lista de strings). */
  obrerosMigracion = computed<string[]>(() => {
    const m = this.b()?.migracion_obreros;
    if (Array.isArray(m)) return m.map((x) => String(x));
    return [];
  });

  /** S4 — actividades agrupadas por bloque para el detalle. */
  actividadesPorBloque = computed(() => {
    const acts = this.b()?.actividades ?? [];
    const grupos = new Map<string, typeof acts>();
    for (const a of acts) {
      const b = (a.bloque ?? '').trim() || 'Sin bloque';
      if (!grupos.has(b)) grupos.set(b, []);
      grupos.get(b)!.push(a);
    }
    return [...grupos.entries()].map(([bloque, items]) => ({ bloque, items }));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const list = await this.bitacora.misBitacoras();
    const b = list.find((x) => x.id === id) ?? null;
    this.b.set(b);
    // BN1 — una orden de trabajo trae su detalle + firmas en tablas hijas: se leen
    // aparte (online, best-effort) y las firmas se resuelven a URL firmada.
    if (b?.tipo === 'orden_trabajo' && id) {
      try {
        const orden = await this.bitacora.ordenTrabajoDetalle(id);
        if (orden?.firmas?.length) {
          await Promise.all(
            orden.firmas.map(async (f) => {
              try {
                f.firma_url = await this.bitacora.getArchivoSignedUrl(f.firma_path);
              } catch {
                f.firma_url = null;
              }
            }),
          );
        }
        this.orden.set(orden);
      } catch {
        /* offline / sin permiso: se muestran los campos generales igual */
      }
    }
    if (b?.archivos?.length) {
      const media = await Promise.all(
        b.archivos.map(async (a) => {
          try {
            const url = await this.bitacora.getArchivoSignedUrl(a.url);
            return {
              url,
              audio: (a.tipo_mime ?? '').startsWith('audio'),
              transcripcion: a.transcripcion ?? null, // AA22
              estado: a.transcripcion_estado ?? null, // AA22
            };
          } catch {
            return null;
          }
        }),
      );
      this.media.set(media.filter((m): m is Media => m !== null));
    }
    this.loading.set(false);
  }

  back(): void {
    this.location.back();
  }

  /** BN1 — comparte el PDF de la orden por el share sheet (→ WhatsApp). */
  async compartirPdf(): Promise<void> {
    const o = this.orden();
    if (!o || this.pdfBusy()) return;
    this.pdfBusy.set(true);
    try {
      await this.ordenPdf.compartir(o);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el PDF.');
    } finally {
      this.pdfBusy.set(false);
    }
  }

  /** BN1 — descarga/guarda el PDF de la orden. */
  async descargarPdf(): Promise<void> {
    const o = this.orden();
    if (!o || this.pdfBusy()) return;
    this.pdfBusy.set(true);
    try {
      const dest = await this.ordenPdf.descargar(o);
      this.toast.success('Orden guardada en ' + dest + '.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el PDF.');
    } finally {
      this.pdfBusy.set(false);
    }
  }
}
