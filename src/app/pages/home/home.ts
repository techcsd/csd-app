import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppLauncher } from '@capacitor/app-launcher';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { Onboarding } from '../../shared/components/onboarding/onboarding';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';
import { BadgesService } from '../../core/services/badges.service';
import { EnProcesoService } from '../../core/services/en-proceso.service';

interface HomeTile {
  modulo: string;
  icon: string;
  label: string;
  route: string;
  tint: string;
}

// One button = one job. Gated by the same SGC module keys as the web.
const TILES: HomeTile[] = [
  { modulo: 'bitacora', icon: '📓', label: 'Bitácora', route: '/bitacora', tint: '#1e3a5f' },
  { modulo: 'flota', icon: '🚚', label: 'Transporte', route: '/transporte', tint: '#f97316' },
  { modulo: 'inventario', icon: '📦', label: 'Inventario', route: '/inventario', tint: '#16a34a' },
  { modulo: 'compras', icon: '🛒', label: 'Requisición', route: '/solicitudes', tint: '#2563eb' },
  // Y14 — Proyectos (gateado por módulo proyectos: admin/direccion/gerencia/
  // gerente_proyectos/ingeniero_oficina). Los responsables sin módulo llegan al
  // cronograma por deep-link de aviso (FASE 5).
  { modulo: 'proyectos', icon: '🏗️', label: 'Proyectos', route: '/proyectos', tint: '#0d9488' },
  { modulo: 'admin', icon: '⚙️', label: 'Administración', route: '/admin', tint: '#3f3f46' },
  // Y11 — Tecnología (admin + rol Tecnología/Encargado de Tecnología). El gating
  // es genérico por módulo: `hasModulo('tecnologia')` ya lo resuelve.
  { modulo: 'tecnologia', icon: '💻', label: 'Tecnología', route: '/tecnologia', tint: '#0891b2' },
];

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, EmptyState, SyncBar, Onboarding],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private ctx = inject(UserContextService);
  private session = inject(SessionService);
  private router = inject(Router);
  private badges = inject(BadgesService);
  private enProceso = inject(EnProcesoService);

  nombre = this.ctx.nombre;
  obra = this.ctx.obraActiva;
  badgeCounts = this.badges.counts; // Q2 — pendientes por módulo
  enProcesoCounts = this.enProceso.counts; // V1 — borradores/envíos por módulo

  // El tile de Tecnología se gatea por módulo como el resto (un chofer NO lo ve).
  // El contenido transversal (Dudas/guías, visitar web) sigue disponible para
  // todos desde el footer del Home, no desde este tile.
  tiles = computed(() => TILES.filter((t) => this.ctx.hasModulo(t.modulo)));

  constructor() {
    // Single-module user (e.g. chofer): drop straight into their module once.
    const work = this.tiles();
    if (work.length === 1 && this.session.consumeAutoEnter()) {
      void this.router.navigate([work[0].route]);
    }
    // Q2 — badges de pendientes por módulo (best-effort, online).
    void this.badges.load();
    // V1 — contador de documentación en proceso (local, offline).
    void this.enProceso.refresh();
  }

  /** Q2+V1 — badge del tile = pendientes de aprobación + documentación en proceso. */
  badgeFor(modulo: string): number | null {
    const total = (this.badgeCounts()[modulo] ?? 0) + (this.enProcesoCounts()[modulo] ?? 0);
    return total || null;
  }

  open(tile: HomeTile): void {
    void this.router.navigate([tile.route]);
  }

  perfil(): void {
    void this.router.navigate(['/perfil']);
  }

  reportar(): void {
    void this.router.navigate(['/reportar']);
  }

  /** AA6 — Dudas como entrada principal: abre Tecnología en la pestaña Dudas. */
  dudas(): void {
    void this.router.navigate(['/tecnologia'], { queryParams: { tab: 'dudas' } });
  }

  /** AA7 — abrir la página web (SGC) en el navegador del sistema. */
  async visitarWeb(): Promise<void> {
    const url = 'https://sgcconstructorasd.com';
    try {
      await AppLauncher.openUrl({ url });
    } catch {
      window.open(url, '_system');
    }
  }
}
