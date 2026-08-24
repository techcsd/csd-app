import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { SolicitudMovimientoService } from '../../core/services/solicitud-movimiento.service';

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

  solicitudesPend = signal(0);

  readonly tiles = computed<IngTile[]>(() => [
    {
      key: 'solicitudMovimiento',
      icon: '🚚',
      label: 'Solicitud de movimiento',
      tint: '#9333ea',
      route: '/transporte/solicitudes-movimiento',
    },
    // AV6 — "Crear ruta" migró a Flota/Transporte (era transporte, no ingeniería).
  ]);

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
