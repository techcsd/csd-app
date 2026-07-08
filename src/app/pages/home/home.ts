import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { UserContextService } from '../../core/services/user-context.service';
import { SessionService } from '../../core/services/session.service';

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
  { modulo: 'compras', icon: '🛒', label: 'Solicitudes', route: '/solicitudes', tint: '#2563eb' },
];

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, SyncBar],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private ctx = inject(UserContextService);
  private session = inject(SessionService);
  private router = inject(Router);

  nombre = this.ctx.nombre;
  obra = this.ctx.obraActiva;

  tiles = computed(() => TILES.filter((t) => this.ctx.hasModulo(t.modulo)));

  constructor() {
    // Single-module user (e.g. chofer): drop straight into their module once.
    const only = this.tiles();
    if (only.length === 1 && this.session.consumeAutoEnter()) {
      void this.router.navigate([only[0].route]);
    }
  }

  open(tile: HomeTile): void {
    void this.router.navigate([tile.route]);
  }

  perfil(): void {
    void this.router.navigate(['/perfil']);
  }
}
