import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../../shared/ui/big-button/big-button';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService } from '../../../core/services/conduces.service';

interface ConduceTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  route: string;
}

// AF22 — núcleo "Conduces": el conduce es el documento central de movimiento de
// material. Cada acción reutiliza su pantalla existente.
// AK8 — menú DEPURADO: se eliminan los submódulos "Recibir", "Por firmar",
// "Devolver a suplidor" y "Compra en ferretería":
//   · Recibir / Por firmar → los cubre la confirmación de entrega (el stock del
//     destino solo sube al confirmar el receptor). Su función vive en "Por confirmar".
//   · Devolver a suplidor → es un conduce con destino suplidor: se hace en "+ Crear
//     conduce" (deep-link con destino=suplidor).
//   · Compra en ferretería → es un conduce con origen ferretería: "+ Crear conduce".
// Las rutas de esos flujos SE CONSERVAN para no romper deep-links/notificaciones
// viejas (solo se quitan del menú). AK1 — se añade "Confirmaciones" (historial).
const TILES: ConduceTile[] = [
  { key: 'crear', icon: '📦', label: '+ Crear conduce', tint: '#7c3aed', route: '/transporte/generar-conduce' },
  { key: 'pendienteEntrega', icon: '🚚', label: 'Pendiente entrega', tint: '#ea580c', route: '/transporte/conduces-pendientes' },
  { key: 'porConfirmar', icon: '📥', label: 'Por confirmar', tint: '#0f766e', route: '/transporte/por-confirmar' },
  { key: 'confirmaciones', icon: '✅', label: 'Confirmaciones', tint: '#0d9488', route: '/transporte/confirmaciones' },
  { key: 'historial', icon: '🗂️', label: 'Histórico', tint: '#1e3a5f', route: '/transporte/conduces-historial' },
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
  private conduces = inject(ConducesService);

  transferenciasPendientes = signal(0);
  pendienteEntrega = signal(0); // AI2
  porConfirmar = signal(0); // AJ8
  porFirmarDespachante = signal(0); // AU1
  porImplementar = signal(0); // AY13

  // AU1/AY13 — las entradas condicionales solo aparecen cuando hay algo que hacer
  // (no ensucian el hub del resto).
  readonly tiles = computed<ConduceTile[]>(() => {
    let out = TILES;
    if (this.porFirmarDespachante() > 0) {
      const extra: ConduceTile = {
        key: 'porFirmar',
        icon: '🖊️',
        label: 'Por firmar (despachante)',
        tint: '#b45309',
        route: '/transporte/conduces-por-firmar',
      };
      out = [out[0], extra, ...out.slice(1)];
    }
    // AY13 — conduces con ítems libres sin vincular (el admin los "implementa" en la web).
    if (this.porImplementar() > 0) {
      const extra: ConduceTile = {
        key: 'porImplementar',
        icon: '🧩',
        label: 'Por implementar',
        tint: '#6d28d9',
        route: '/transporte/conduces-por-implementar',
      };
      out = [...out, extra];
    }
    return out;
  });

  constructor() {
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
    // AU1 — conduces donde soy despachante y no he firmado (muestra el tile + badge).
    void this.conduces
      .misConducesPorFirmarCount()
      .then((n) => this.porFirmarDespachante.set(n))
      .catch(() => {});
    // AY13 — conduces con ítems libres sin vincular (muestra el tile + badge).
    void this.conduces
      .conducesPorImplementarCount()
      .then((n) => this.porImplementar.set(n))
      .catch(() => {});
  }

  badgeFor(key: string): number | null {
    if (key === 'transferencias') return this.transferenciasPendientes() || null;
    if (key === 'pendienteEntrega') return this.pendienteEntrega() || null;
    if (key === 'porConfirmar') return this.porConfirmar() || null;
    if (key === 'porFirmar') return this.porFirmarDespachante() || null;
    if (key === 'porImplementar') return this.porImplementar() || null;
    return null;
  }

  open(t: ConduceTile): void {
    void this.router.navigate([t.route]);
  }

  back(): void {
    this.location.back();
  }
}
