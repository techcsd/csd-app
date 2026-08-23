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
    {
      // La ruta /transporte/rutas/crear admite flota|ingenieria (moduleAnyGuard),
      // pero antes no se ofrecía desde acá → el ingeniero no la encontraba.
      key: 'crearRuta',
      icon: '🗺️',
      label: 'Crear ruta',
      tint: '#0891b2',
      route: '/transporte/rutas/crear',
    },
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
