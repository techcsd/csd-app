import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../../shared/ui/big-button/big-button';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { InventarioService } from '../../../core/services/inventario.service';
import { ConducesService } from '../../../core/services/conduces.service';

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
// AI2 — menú del módulo Conduce (sketch de Eduardo): [+ Crear conduce]
// [Pendiente entrega ①] [Histórico]. Las demás acciones (recibir/devolver/
// ferretería/por firmar/transferencias) quedan como operativos secundarios.
// AJ8 — "Devolver" ya no es un submódulo: la devolución es un conduce con destino
// suplidor/almacén, así que el tile abre el wizard de conduce pre-llenado.
const TILES: ConduceTile[] = [
  { key: 'crear', icon: '📦', label: '+ Crear conduce', tint: '#7c3aed', route: '/transporte/generar-conduce' },
  { key: 'pendienteEntrega', icon: '🚚', label: 'Pendiente entrega', tint: '#ea580c', route: '/transporte/conduces-pendientes' },
  { key: 'porConfirmar', icon: '📥', label: 'Por confirmar', tint: '#0f766e', route: '/transporte/por-confirmar' },
  { key: 'historial', icon: '🗂️', label: 'Histórico', tint: '#1e3a5f', route: '/transporte/conduces-historial' },
  { key: 'recibir', icon: '📦', label: 'Recibir', tint: '#0f766e', route: '/transporte/recibir-mercancia' },
  { key: 'devolver', icon: '↩️', label: 'Devolver a suplidor', tint: '#0f766e', route: '/transporte/generar-conduce' },
  { key: 'ferreteria', icon: '🧾', label: 'Compra en ferretería', tint: '#9333ea', route: '/transporte/ferreteria' },
  { key: 'porFirmar', icon: '✍️', label: 'Por firmar', tint: '#ca8a04', route: '/transporte/por-firmar' },
  { key: 'transferencias', icon: '↔️', label: 'Transferencias', tint: '#0369a1', route: '/transporte/conduce-transferencias' },
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
  private conduces = inject(ConducesService);

  readonly tiles = TILES;
  firmasPendientes = signal(0);
  transferenciasPendientes = signal(0);
  pendienteEntrega = signal(0); // AI2
  porConfirmar = signal(0); // AJ8

  constructor() {
    void this.inventario
      .misFirmasPendientes()
      .then((l) => this.firmasPendientes.set(l.length))
      .catch(() => {});
    // AH5 — badge de transferencias de conduce que me ofrecieron (por aceptar).
    void this.conduces
      .misTransferenciasPendientes()
      .then((l) => this.transferenciasPendientes.set(l.length))
      .catch(() => {});
    // AI2 — badge de conduces emitidos pendientes de entrega.
    void this.conduces
      .pendientesEntregaCount()
      .then((n) => this.pendienteEntrega.set(n))
      .catch(() => {});
    // AJ8 — badge de entregas que YO debo confirmar (receptor).
    void this.conduces
      .entregasPorConfirmarCount()
      .then((n) => this.porConfirmar.set(n))
      .catch(() => {});
  }

  badgeFor(key: string): number | null {
    if (key === 'porFirmar') return this.firmasPendientes() || null;
    if (key === 'transferencias') return this.transferenciasPendientes() || null;
    if (key === 'pendienteEntrega') return this.pendienteEntrega() || null;
    if (key === 'porConfirmar') return this.porConfirmar() || null;
    return null;
  }

  open(t: ConduceTile): void {
    // AJ8 — "Devolver a suplidor" abre el conduce pre-llenado (destino suplidor).
    if (t.key === 'devolver') {
      void this.router.navigate(['/transporte/generar-conduce'], {
        queryParams: { origen: 'almacen', destino: 'suplidor' },
      });
      return;
    }
    void this.router.navigate([t.route]);
  }

  back(): void {
    this.location.back();
  }
}
