import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../../shared/ui/big-button/big-button';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { InventarioService } from '../../../core/services/inventario.service';

interface ConduceTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  route: string;
}

// AF22 — núcleo "Conduces": el conduce es el documento central de movimiento de
// material. Todas las acciones de conduce viven aquí (crear/recibir/devolver/
// ferretería/por firmar/historial). Cada una reutiliza su pantalla existente.
const TILES: ConduceTile[] = [
  { key: 'crear', icon: '📦', label: 'Crear conduce', tint: '#7c3aed', route: '/transporte/generar-conduce' },
  { key: 'recibir', icon: '📥', label: 'Recibir', tint: '#0f766e', route: '/transporte/recibir-mercancia' },
  { key: 'devolver', icon: '↩️', label: 'Devolver', tint: '#0f766e', route: '/transporte/devolver-material' },
  { key: 'ferreteria', icon: '🧾', label: 'Compra en ferretería', tint: '#9333ea', route: '/transporte/ferreteria' },
  { key: 'porFirmar', icon: '✍️', label: 'Por firmar', tint: '#ca8a04', route: '/transporte/por-firmar' },
  { key: 'historial', icon: '🗂️', label: 'Historial de conduces', tint: '#1e3a5f', route: '/transporte/conduces-historial' },
];

/** AF22 — sub-hub de Conduces (Transporte v2). */
@Component({
  selector: 'app-conduces-hub',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, SyncBar],
  templateUrl: './conduces-hub.html',
  styleUrl: './conduces-hub.scss',
})
export class ConducesHubPage {
  private router = inject(Router);
  private location = inject(Location);
  private inventario = inject(InventarioService);

  readonly tiles = TILES;
  firmasPendientes = signal(0);

  constructor() {
    void this.inventario
      .misFirmasPendientes()
      .then((l) => this.firmasPendientes.set(l.length))
      .catch(() => {});
  }

  badgeFor(key: string): number | null {
    if (key === 'porFirmar') return this.firmasPendientes() || null;
    return null;
  }

  open(t: ConduceTile): void {
    void this.router.navigate([t.route]);
  }

  back(): void {
    this.location.back();
  }
}
