import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { SolicitudMovimientoService } from '../../core/services/solicitud-movimiento.service';
import { UserContextService } from '../../core/services/user-context.service';

interface IngTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  route: string;
}

/**
 * AY11 — hub de "Ingeniería": concentra los submódulos de ingenieros/producción.
 * Hoy: Solicitud de movimiento (pedir al depto. de transporte mover material/equipo;
 * los referentes planifican creando la ruta). Extensible para más submódulos.
 *
 * AV6 — árbol canónico web↔app: "Crear ruta" es de FLOTA/Transporte (una ruta es
 * transporte: vehículo, chofer, paradas, tracking), NO de Ingeniería — se retiró de
 * este hub. Ingeniería ORIGINA la Solicitud de movimiento; el referente la convierte
 * en ruta desde ahí (Planificar) o desde Flota. La ruta /transporte/rutas/crear sigue
 * admitiendo flota|ingenieria (deep-links vivos), solo dejó de ofrecerse suelta acá.
 */
@Component({
  selector: 'app-ingenieria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, SyncBar],
  templateUrl: './ingenieria.html',
  styleUrl: './ingenieria.scss',
})
export class IngenieriaPage {
  private router = inject(Router);
  private location = inject(Location);
  private solicitudes = inject(SolicitudMovimientoService);
  private ctx = inject(UserContextService);

  solicitudesPend = signal(0);

  /**
   * BH2 — el hub de Ingeniería concentra el trabajo de ingenieros/producción,
   * enlazando las pantallas que ya existen (deja de tener 1 solo item). Cada tile
   * respeta el MISMO gate que el guard de su ruta (regla BH1: nada visible que dé
   * 403). Por ahora los tiles conviven con los del home (atajos); el traslado puro
   * —quitarlos del home— espera el mock aprobado (lección BD1). Los 2 huecos reales
   * de capacidad (Dashboard de bitácora, Mi proyecto) se construyen aparte.
   */
  readonly tiles = computed<IngTile[]>(() => {
    const c = this.ctx;
    const t: IngTile[] = [];
    // Requisición (ingeniero origina por compras.solicitudes; coord. compras por módulo).
    if (c.esAdmin() || c.hasModulo('compras') || c.puedeVerSubmodulo('compras.solicitudes')) {
      t.push({ key: 'requisicion', icon: '🛒', label: 'Requisición', tint: '#2563eb', route: '/solicitudes' });
    }
    // Solicitud de movimiento (el corazón original del hub, AY11).
    t.push({ key: 'solicitudMovimiento', icon: '🚚', label: 'Solicitud de movimiento', tint: '#9333ea', route: '/transporte/solicitudes-movimiento' });
    // Confirmar entregas ("Por recibir") — receptores sin módulo flota (inventario/obra).
    if (c.esAdmin() || c.hasModulo('inventario') || c.puedeVerObra()) {
      t.push({ key: 'porRecibir', icon: '📥', label: 'Confirmar entregas', tint: '#ca8a04', route: '/transporte/por-confirmar' });
    }
    // Bitácora (suite completa).
    if (c.esAdmin() || c.hasModulo('bitacora')) {
      t.push({ key: 'bitacora', icon: '📓', label: 'Bitácora', tint: '#1e3a5f', route: '/bitacora' });
      // BH2 — Dashboard de bitácora (hueco de capacidad construido en la app).
      t.push({ key: 'bitacoraDashboard', icon: '📊', label: 'Dashboard de bitácora', tint: '#2563eb', route: '/bitacora/dashboard' });
    }
    // Mi obra (producción: plan del día, avance, NC, checklists, subcontratistas…).
    if (c.puedeVerObra()) {
      t.push({ key: 'obra', icon: '🦺', label: 'Mi obra', tint: '#0f766e', route: '/obra' });
      // BH2 — Mi proyecto (hueco de capacidad construido en la app).
      t.push({ key: 'miProyecto', icon: '🏗️', label: 'Mi proyecto', tint: '#0369a1', route: '/obra/mi-proyecto' });
    }
    // Personal de obra (matriz amplia; la RLS acota los datos a la obra).
    if (c.esAdmin() || c.hasModulo('proyectos') || c.hasModulo('rrhh') || c.puedeVerSubmodulo('proyectos.personal') || c.puedeVerObra()) {
      t.push({ key: 'personal', icon: '🧑‍🔧', label: 'Personal de obra', tint: '#9333ea', route: '/proyectos/personal' });
    }
    // Compras de obra (consulta AH15) — quien tiene acceso a proyectos/compras/obra.
    if (c.esAdmin() || c.hasModulo('proyectos') || c.hasModulo('compras') || c.puedeVerObra()) {
      t.push({ key: 'comprasProyecto', icon: '💰', label: 'Compras de obra', tint: '#b45309', route: '/compras-proyecto' });
    }
    // Solicitud de compra a mano (BH8) — equipo de Compras.
    if (c.esAdmin() || c.hasModulo('compras')) {
      t.push({ key: 'solicitudCompra', icon: '🛍️', label: 'Solicitud de compra', tint: '#b45309', route: '/compras/solicitud-compra' });
    }
    return t;
  });

  constructor() {
    void this.solicitudes.pendientesCount().then((n) => this.solicitudesPend.set(n)).catch(() => {});
  }

  badgeFor(key: string): number | null {
    if (key === 'solicitudMovimiento') return this.solicitudesPend() || null;
    return null;
  }

  open(t: IngTile): void {
    void this.router.navigate([t.route]);
  }

  back(): void {
    this.location.back();
  }
}
