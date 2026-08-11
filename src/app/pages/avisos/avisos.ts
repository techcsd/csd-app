import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { LiveRefreshDirective } from '../../shared/ui/live-refresh/live-refresh.directive';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { NotificacionesService, Notificacion, notifAppRoute } from '../../core/services/notificaciones.service';
import { ToastService } from '../../core/services/toast.service';
import { formatFechaCortaHora } from '../../core/util/fecha';

/** AE — bandeja de avisos in-app (sgc.notificaciones): firmas pendientes, cierres,
 *  avisos de módulo. Tocar un aviso lo marca leído y navega a su destino (AF6). */
@Component({
  selector: 'app-avisos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, ConfirmDialog, LiveRefreshDirective],
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
  refrescando = signal(false);
  avisos = signal<Notificacion[]>([]);
  confirmBorrarTodas = signal(false);

  constructor() {
    void this.load();
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.avisos.set(await this.service.getMisNotificaciones());
    } catch {
      this.toast.error('No se pudieron cargar los avisos.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.load(silent);
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
    // AF6 — deep-link: traduce la ruta (a veces web) a una ruta válida de la app.
    const dest = notifAppRoute(n);
    if (dest && dest !== '/home') {
      try {
        await this.router.navigateByUrl(dest);
      } catch {
        /* ignore */
      }
    }
  }

  /** ¿este aviso lleva a algún lado? (para pintar la flecha ›). */
  tieneDestino(n: Notificacion): boolean {
    return notifAppRoute(n) !== '/home';
  }

  /** AF6 — eliminar un aviso (optimista + rollback si falla). */
  async eliminar(n: Notificacion, ev: Event): Promise<void> {
    ev.stopPropagation();
    const prev = this.avisos();
    this.avisos.set(prev.filter((x) => x.id !== n.id));
    try {
      await this.service.eliminar(n.id, !n.leida);
    } catch {
      this.avisos.set(prev); // rollback
      this.toast.error('No se pudo eliminar el aviso.');
    }
  }

  /** AF6 — "borrar todas" (con confirmación). */
  pedirBorrarTodas(): void {
    this.confirmBorrarTodas.set(true);
  }
  cancelarBorrarTodas(): void {
    this.confirmBorrarTodas.set(false);
  }
  async borrarTodas(): Promise<void> {
    this.confirmBorrarTodas.set(false);
    const prev = this.avisos();
    this.avisos.set([]);
    try {
      await this.service.eliminarTodas();
      this.toast.success('Avisos eliminados.');
    } catch {
      this.avisos.set(prev);
      this.toast.error('No se pudieron eliminar.');
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
