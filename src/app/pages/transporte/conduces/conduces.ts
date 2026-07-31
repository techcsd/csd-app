import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService, RutaDetalleApp } from '../../../core/services/conduces.service';
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
export class ConducesPage implements OnDestroy {
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

  // AC13/AC6 — detalle de ruta (paradas + fotos) expandible en el sitio.
  private expandidas = signal<Set<string>>(new Set());
  private detalles = signal<Record<string, RutaDetalleApp>>({});
  estaExpandida(id: string): boolean {
    return this.expandidas().has(id);
  }
  detalle(id: string): RutaDetalleApp | null {
    return this.detalles()[id] ?? null;
  }
  toggleDetalle(rutaId: string): void {
    const abierto = this.expandidas().has(rutaId);
    this.expandidas.update((s) => {
      const next = new Set(s);
      abierto ? next.delete(rutaId) : next.add(rutaId);
      return next;
    });
    if (!abierto && !this.detalles()[rutaId]) {
      void this.service
        .getRutaDetalle(rutaId)
        .then((d) => this.detalles.update((m) => ({ ...m, [rutaId]: d })));
    }
  }

  /** Y4 — reloj que avanza cada segundo para el contador en vivo de rutas en curso. */
  now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    void this.load();
    // El contador se calcula desde `iniciada_at` (no un acumulador en memoria),
    // así sobrevive a salir y volver a la pantalla.
    this.timer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [c, r] = await Promise.all([this.service.misConduces(), this.service.misRutas()]);
      this.conduces.set(c);
      this.rutas.set(r);
      // Y3 — al ver la lista, las rutas planificadas dejan de ser "nuevas" (limpia el badge).
      void this.service.marcarRutasVistas();
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
    // Y4 — capturar el instante del TAP (no el del round-trip al servidor).
    const at = new Date().toISOString();
    try {
      await this.service.marcarRuta(rutaId, estado, at);
      this.rutas.update((list) =>
        list.map((r) =>
          r.id === rutaId
            ? {
                ...r,
                estado,
                // Optimista: arranca el contador / fija el fin al instante del TAP.
                iniciada_at: estado === 'en_curso' ? (r.iniciada_at ?? at) : r.iniciada_at,
                finalizada_at: estado === 'completada' ? at : r.finalizada_at,
              }
            : r,
        ),
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

  // ---- Y4 — tiempos de ruta -------------------------------------------------

  private fmtHms(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  /** Contador en vivo (hh:mm:ss) de una ruta en curso; null si no aplica. */
  cronometro(r: RutaHoy): string | null {
    if (r.estado !== 'en_curso' || !r.iniciada_at) return null;
    return this.fmtHms(this.now() - new Date(r.iniciada_at).getTime());
  }

  /** Resumen "real vs estimado" de una ruta completada; null si faltan datos. */
  resumenTiempo(r: RutaHoy): { real: number; est: number | null; pct: number | null } | null {
    if (r.estado !== 'completada' || !r.iniciada_at || !r.finalizada_at) return null;
    const real = Math.max(
      0,
      Math.round((new Date(r.finalizada_at).getTime() - new Date(r.iniciada_at).getTime()) / 60000),
    );
    const est = r.tiempo_estimado_min ?? null;
    const pct = est && est > 0 ? Math.round(((real - est) / est) * 100) : null;
    return { real, est, pct };
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
