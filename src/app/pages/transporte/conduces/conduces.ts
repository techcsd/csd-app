import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService } from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { Conduce, RutaHoy } from '../../../core/models/transporte.model';

const ESTADO_RUTA_LABEL: Record<string, string> = {
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

/** Driver's routes + dispatched conduces for the day. */
@Component({
  selector: 'app-conduces',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, DecimalPipe],
  templateUrl: './conduces.html',
  styleUrl: './conduces.scss',
})
export class ConducesPage {
  private service = inject(ConducesService);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  estadoLabel(estado: string): string {
    return ESTADO_RUTA_LABEL[estado] ?? estado;
  }

  conduces = signal<Conduce[]>([]);
  rutas = signal<RutaHoy[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [c, r] = await Promise.all([this.service.misConduces(), this.service.misRutas()]);
      this.conduces.set(c);
      this.rutas.set(r);
    } finally {
      this.loading.set(false);
    }
  }

  entregar(conduce: Conduce): void {
    void this.router.navigate(['/transporte/conduces', conduce.id]);
  }

  crearRuta(): void {
    void this.router.navigate(['/transporte/rutas/crear']);
  }

  async ruta(rutaId: string, estado: 'en_curso' | 'completada'): Promise<void> {
    try {
      await this.service.marcarRuta(rutaId, estado);
      this.rutas.update((list) =>
        list.map((r) => (r.id === rutaId ? { ...r, estado } : r)),
      );
    } catch (e) {
      this.toast.error(
        !this.network.online()
          ? 'Sin señal. Vuelve a intentar la ruta cuando tengas conexión.'
          : e instanceof Error
            ? e.message
            : 'No se pudo actualizar la ruta.',
      );
    }
  }

  /**
   * W2 — abre la NAVEGACIÓN de Google Maps hacia el destino de la ruta.
   * En nativo intenta el intent `google.navigation:` (abre la app de Maps con la
   * ruta trazada); si Maps no está instalado o el intent falla, cae a la URL
   * https. En web/PWA siempre usa la URL https.
   */
  async comoLlegar(r: RutaHoy): Promise<void> {
    if (!r.destino) return;
    const httpsUrl =
      'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.destino);

    if (Capacitor.isNativePlatform()) {
      try {
        // Sin coords disponibles en la ruta → navegación por texto del destino.
        const navUrl = 'google.navigation:q=' + encodeURIComponent(r.destino);
        const { value } = await AppLauncher.canOpenUrl({ url: navUrl });
        if (value) {
          await AppLauncher.openUrl({ url: navUrl });
          return;
        }
      } catch {
        /* cae al fallback https */
      }
      try {
        await AppLauncher.openUrl({ url: httpsUrl });
        return;
      } catch {
        /* último recurso: window.open */
      }
    }
    window.open(httpsUrl, '_system');
  }

  back(): void {
    this.location.back();
  }
}
