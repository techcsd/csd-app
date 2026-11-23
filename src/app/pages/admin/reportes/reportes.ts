import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, Reporte, ReporteAdjunto } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaHumana } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';
import { I18nService } from '../../../core/i18n/i18n.service';

/** Admin view of field reports/comments, with resolve. */
@Component({
  selector: 'app-admin-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class AdminReportesPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private i18n = inject(I18nService);

  reportes = signal<Reporte[]>([]);
  loading = signal(true);
  fmtFecha = formatFechaHumana; // U9
  expandedId = signal<string | null>(null);
  respuesta = signal('');
  saving = signal(false);
  // DX10 — adjuntos del reporte abierto (fotos + documentos), con su nombre original
  adjuntos = signal<ReporteAdjunto[]>([]);
  cargandoAdjuntos = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.reportes.set(await this.admin.getReportes());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('Error al cargar.'));
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string): string {
    return t === 'bug' ? '🐞 Problema' : t === 'sugerencia' ? '💡 Sugerencia' : '💬 Comentario';
  }

  toggle(r: Reporte): void {
    this.expandedId.set(this.expandedId() === r.id ? null : r.id);
    this.respuesta.set('');
    this.adjuntos.set([]);
    if (this.expandedId() === r.id) void this.cargarAdjuntos(r.id);
  }

  private async cargarAdjuntos(id: string): Promise<void> {
    this.cargandoAdjuntos.set(true);
    try {
      const lista = await this.admin.getAdjuntosReporte(id);
      if (this.expandedId() === id) this.adjuntos.set(lista);
    } catch {
      /* los adjuntos son un extra: el reporte se lee igual */
    } finally {
      this.cargandoAdjuntos.set(false);
    }
  }

  /** DX10 — abre/descarga un adjunto. Office/PDF/CSV: solo descarga con su nombre (sin previsualizar). */
  async abrirAdjunto(a: ReporteAdjunto): Promise<void> {
    const url = await this.admin.urlAdjuntoReporte(a.path, a.esFoto ? null : a.nombre);
    if (!url) {
      this.toast.error(this.i18n.t('No se pudo abrir el archivo. Intenta de nuevo.'));
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async resolver(r: Reporte): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.admin.resolverReporte(r.id, this.respuesta());
      this.reportes.update((list) =>
        list.map((x) => (x.id === r.id ? { ...x, estado: 'resuelto', respuesta_admin: this.respuesta() } : x)),
      );
      this.expandedId.set(null);
      this.toast.success(this.i18n.t('Reporte resuelto.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('Error.'));
    } finally {
      this.saving.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
