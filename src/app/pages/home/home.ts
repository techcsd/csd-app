import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
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
  { modulo: 'admin', icon: '⚙️', label: 'Administración', route: '/admin', tint: '#3f3f46' },
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

  tiles = computed(() => TILES.filter((t) => this.ctx.hasModulo(t.modulo)));

  constructor() {
    // Single-module user (e.g. chofer): drop straight into their module once.
    const only = this.tiles();
    if (only.length === 1 && this.session.consumeAutoEnter()) {
      void this.router.navigate([only[0].route]);
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
}
