import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { OrdenTrabajoPdfService } from '../../../core/services/orden-trabajo-pdf.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrdenTrabajoDetalle } from '../../../core/models/bitacora.model';
import { formatFecha, formatFechaMedia } from '../../../core/util/fecha';

interface UsuarioBusqueda {
  id: string;
  nombre: string;
  email?: string | null;
}

/**
 * BW1 — ficha de una Orden de trabajo (nota #65: "no hay forma de ver ni compartir
 * la orden que un usuario crea"). Carga `orden_trabajo_detalle` (funciona para
 * cualquier OT que el usuario pueda ver, incluidas las de sus obras si es elevado),
 * muestra el número visible OT-000123, el estado derivado de las firmas, el detalle
 * y las firmas, y ofrece **Ver PDF**, **Compartir** (share sheet nativo → WhatsApp)
 * y **Enviar a…** (usuarios del sistema → notificación con deep-link a esta ficha).
 */
@Component({
  selector: 'app-orden-trabajo-ficha',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, TranslatePipe],
  templateUrl: './orden-trabajo-ficha.html',
  styleUrl: './orden-trabajo-ficha.scss',
})
export class OrdenTrabajoFichaPage {
  private route = inject(ActivatedRoute);
  private bitacora = inject(BitacoraService);
  private ordenPdf = inject(OrdenTrabajoPdfService);
  private location = inject(Location);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  orden = signal<OrdenTrabajoDetalle | null>(null);
  pdfBusy = signal(false);

  // BW1 — número visible OT-000123 (del correlativo de la orden).
  codigo = computed(() => 'OT-' + String(this.orden()?.detalle?.numero ?? 0).padStart(6, '0'));

  // Estado derivado de las firmas (mismo criterio que el server).
  estado = computed<'borrador' | 'emitida' | 'firmada'>(() => {
    const firmas = this.orden()?.firmas ?? [];
    const ing = firmas.some((f) => f.rol === 'ingeniero');
    const cli = firmas.some((f) => f.rol === 'cliente');
    if (ing && cli) return 'firmada';
    if (ing) return 'emitida';
    return 'borrador';
  });
  estadoLabel = computed(() => {
    const e = this.estado();
    return e === 'firmada' ? this.i18n.t('Firmada') : e === 'emitida' ? this.i18n.t('Emitida') : this.i18n.t('Borrador');
  });

  // ── Enviar a… (compartir con usuarios del sistema) ──────────────────────────
  enviarAbierto = signal(false);
  term = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);
  destinatarios = signal<UsuarioBusqueda[]>([]);
  enviando = signal(false);
  private debounce?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(false);
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
      if (!orden) this.error.set(true);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  reintentar(): void {
    void this.load();
  }

  // ── PDF ─────────────────────────────────────────────────────────────────────
  async compartirPdf(): Promise<void> {
    const o = this.orden();
    if (!o || this.pdfBusy()) return;
    this.pdfBusy.set(true);
    try {
      await this.ordenPdf.compartir(o);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo generar el PDF.'));
    } finally {
      this.pdfBusy.set(false);
    }
  }

  async descargarPdf(): Promise<void> {
    const o = this.orden();
    if (!o || this.pdfBusy()) return;
    this.pdfBusy.set(true);
    try {
      const dest = await this.ordenPdf.descargar(o);
      this.toast.success(this.i18n.t('Orden guardada en {dest}.', { dest }));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar el PDF.'));
    } finally {
      this.pdfBusy.set(false);
    }
  }

  // ── Enviar a… ────────────────────────────────────────────────────────────────
  toggleEnviar(): void {
    this.enviarAbierto.update((v) => !v);
  }

  onTerm(v: string): void {
    this.term.set(v);
    if (this.debounce) clearTimeout(this.debounce);
    const t = v.trim();
    if (t.length < 2) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }
    this.buscando.set(true);
    this.debounce = setTimeout(async () => {
      try {
        const elegidos = new Set(this.destinatarios().map((u) => u.id));
        const r = await this.bitacora.buscarUsuarios(t);
        this.resultados.set(r.filter((u) => !elegidos.has(u.id)));
      } catch {
        this.resultados.set([]);
      } finally {
        this.buscando.set(false);
      }
    }, 300);
  }

  agregar(u: UsuarioBusqueda): void {
    if (this.destinatarios().some((x) => x.id === u.id)) return;
    this.destinatarios.update((list) => [...list, u]);
    this.resultados.update((list) => list.filter((x) => x.id !== u.id));
    this.term.set('');
    this.resultados.set([]);
  }

  quitar(u: UsuarioBusqueda): void {
    this.destinatarios.update((list) => list.filter((x) => x.id !== u.id));
  }

  async enviar(): Promise<void> {
    const o = this.orden();
    const ids = this.destinatarios().map((u) => u.id);
    if (!o || !ids.length || this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.bitacora.compartirOrdenTrabajo(o.bitacora.id, ids);
      this.toast.success(
        ids.length === 1
          ? this.i18n.t('Orden enviada a {n}.', { n: this.destinatarios()[0].nombre })
          : this.i18n.t('Orden enviada a {n} personas.', { n: ids.length }),
      );
      this.destinatarios.set([]);
      this.term.set('');
      this.resultados.set([]);
      this.enviarAbierto.set(false);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo enviar.'));
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
