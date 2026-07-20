import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SyncService } from '../../../core/sync/sync.service';
import { NetworkService } from '../../../core/services/network.service';

/**
 * Fixed bottom bar with the global sync status (todo enviado / N pendientes /
 * sin señal). Always visible so the field user trusts nothing is lost.
 */
@Component({
  selector: 'app-sync-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sync-bar.html',
  styleUrl: './sync-bar.scss',
})
export class SyncBar {
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private router = inject(Router);

  online = this.network.online;
  pending = this.sync.pendingCount;
  errors = this.sync.errorCount;
  syncing = this.sync.syncing;

  state = computed<'offline' | 'syncing' | 'pending' | 'error' | 'clear'>(() => {
    if (this.errors() > 0) return 'error';
    if (!this.online()) return 'offline';
    if (this.syncing()) return 'syncing';
    if (this.pending() > 0) return 'pending';
    return 'clear';
  });

  text = computed(() => {
    switch (this.state()) {
      case 'error':
        return `${this.errors()} con problema · toca para revisar`;
      case 'offline':
        return this.pending() > 0
          ? `Sin señal · ${this.pending()} se enviarán solos`
          : 'Sin señal · todo guardado';
      case 'syncing':
        return 'Enviando…';
      case 'pending':
        return `${this.pending()} pendientes de enviar`;
      default:
        return 'Todo enviado';
    }
  });

  icon = computed(() => {
    switch (this.state()) {
      case 'error':
        return '⚠️';
      case 'offline':
        return '📴';
      case 'syncing':
        return '🔄';
      case 'pending':
        return '⏳';
      default:
        return '✅';
    }
  });

  /** P5 — tocar la barra abre "Pendientes de envío" (diagnóstico + acciones por
   *  item), en vez de reintentar a ciegas. Si no hay nada pendiente ni en error,
   *  no hace falta abrir la pantalla. */
  abrir(): void {
    if (this.pending() === 0 && this.errors() === 0) return;
    void this.router.navigate(['/pendientes']);
  }
}
