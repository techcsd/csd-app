import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { NotificacionesService, Notificacion } from '../../core/services/notificaciones.service';
import { ToastService } from '../../core/services/toast.service';
import { formatFechaCortaHora } from '../../core/util/fecha';

/** AE — bandeja de avisos in-app (sgc.notificaciones): firmas pendientes, cierres,
 *  avisos de módulo. Tocar un aviso lo marca leído y navega a su destino. */
@Component({
  selector: 'app-avisos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './avisos.html',
  styleUrl: './avisos.scss',
})
export class AvisosPage {
  private service = inject(NotificacionesService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  avisos = signal<Notificacion[]>([]);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.avisos.set(await this.service.getMisNotificaciones());
    } catch {
      this.toast.error('No se pudieron cargar los avisos.');
    } finally {
      this.loading.set(false);
    }
  }

  iconFor(tipo: string): string {
    if (tipo === 'firma') return '✍️';
    if (tipo === 'error' || tipo === 'alerta') return '⚠️';
    return '🔔';
  }

  async abrir(n: Notificacion): Promise<void> {
    if (!n.leida) {
      this.avisos.update((list) => list.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      void this.service.marcarLeida(n.id).catch(() => {});
    }
    if (n.ruta) {
      // Best-effort: si la ruta no existe en la app, el router cae al fallback.
      try {
        await this.router.navigateByUrl(n.ruta);
      } catch {
        /* ignore */
      }
    }
  }

  async marcarTodas(): Promise<void> {
    try {
      await this.service.marcarTodasLeidas();
      this.avisos.update((list) => list.map((x) => ({ ...x, leida: true })));
      this.toast.success('Avisos marcados como leídos.');
    } catch {
      this.toast.error('No se pudo actualizar.');
    }
  }

  get hayNoLeidos(): boolean {
    return this.avisos().some((n) => !n.leida);
  }

  back(): void {
    this.location.back();
  }
}
