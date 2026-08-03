import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
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
import { InventarioService } from '../../core/services/inventario.service';
import { SyncService } from '../../core/sync/sync.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';

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

// AC4 — Notas: módulo GENERAL accesible por TODOS (incluidos choferes), como
// Mensajes. No se gatea por módulo SGC; se muestra siempre.
const NOTAS_TILE: HomeTile = { modulo: 'notas', icon: '🗒️', label: 'Notas', route: '/notas', tint: '#7c3aed' };

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
  private inventario = inject(InventarioService);
  private sync = inject(SyncService);
  private notificaciones = inject(NotificacionesService);
  avisosNoLeidos = this.notificaciones.noLeidas;

  nombre = this.ctx.nombre;
  obra = this.ctx.obraActiva;
  badgeCounts = this.badges.counts; // Q2 — pendientes por módulo
  enProcesoCounts = this.enProceso.counts; // V1 — borradores/envíos por módulo
  // AE — firmas de recepción PENDIENTES asignadas a mí (banner de descubrimiento,
  // porque un ingeniero receptor puede no tener el módulo flota).
  firmasPendientes = signal(0);
  private primerSync = true;

  // Tiles de trabajo: gateados por el módulo SGC del usuario (igual que la web).
  // Tecnología se excluye de aquí porque NO es un módulo de trabajo (ver `tiles`).
  // AD6 — el chofer NO ve Inventario: sus funciones de inventario viven ahora en
  // Transporte (Recibir mercancía / Compra en ferretería). El acceso temporal al
  // módulo se revierte en SGC tras publicar esta versión; aquí ya lo ocultamos.
  private workTiles = computed(() =>
    TILES.filter(
      (t) =>
        t.modulo !== 'tecnologia' &&
        this.ctx.hasModulo(t.modulo) &&
        !(t.modulo === 'inventario' && this.ctx.esChofer()),
    ),
  );

  // AC2 — Tecnología es pública para TODOS excepto el rol chofer. No se gatea por
  // el módulo 'tecnologia' (que solo tienen admin/tecnología) sino por !esChofer,
  // así lo ven también dirección/gerencia/jefes/ingenieros. El contenido
  // restringido (Versiones/Errores) sigue gateado por rol dentro de la página.
  // El contenido transversal (Dudas/guías, visitar web) está en el footer para
  // todos, incluidos los choferes.
  tiles = computed(() => {
    const work = this.workTiles();
    // AC4 — Notas es general (todos, incl. choferes). Tecnología, todos menos chofer.
    const extra: HomeTile[] = [NOTAS_TILE];
    if (!this.ctx.esChofer()) {
      const tec = TILES.find((t) => t.modulo === 'tecnologia');
      if (tec) extra.push(tec);
    }
    return [...work, ...extra];
  });

  constructor() {
    // Single work-module user (e.g. guarda de almacén): drop straight into their
    // module once. Tecnología no cuenta (es transversal), así el auto-entrar de
    // mono-módulo se mantiene aunque el tile de Tecnología esté presente.
    const work = this.workTiles();
    if (work.length === 1 && this.session.consumeAutoEnter()) {
      void this.router.navigate([work[0].route]);
    }
    // Q2 — badges de pendientes por módulo (best-effort, online).
    void this.badges.load();
    // V1 — contador de documentación en proceso (local, offline).
    void this.enProceso.refresh();
    // AE — cuántas firmas de recepción me quedan por firmar (recarga al drenar).
    void this.cargarFirmasPendientes();
    // AE — avisos no leídos (badge de la campana). Best-effort, online.
    void this.notificaciones.refreshNoLeidas();
    effect(() => {
      this.sync.changed();
      if (this.primerSync) {
        this.primerSync = false;
        return;
      }
      if (this.sync.pendingCount() === 0) void this.cargarFirmasPendientes();
    });
  }

  private async cargarFirmasPendientes(): Promise<void> {
    try {
      this.firmasPendientes.set((await this.inventario.misFirmasPendientes()).length);
    } catch {
      /* best-effort */
    }
  }

  irPorFirmar(): void {
    void this.router.navigate(['/transporte/por-firmar']);
  }

  avisos(): void {
    void this.router.navigate(['/avisos']);
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
