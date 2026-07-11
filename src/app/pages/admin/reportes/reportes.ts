import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DatePipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, Reporte } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

/** Admin view of field reports/comments, with resolve. */
@Component({
  selector: 'app-admin-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, DatePipe, FormsModule],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class AdminReportesPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

  reportes = signal<Reporte[]>([]);
  loading = signal(true);
  expandedId = signal<string | null>(null);
  respuesta = signal('');
  saving = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.reportes.set(await this.admin.getReportes());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Error al cargar.');
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
      this.toast.success('Reporte resuelto.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Error.');
    } finally {
      this.saving.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
