import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SyncService } from '../../../core/sync/sync.service';
import { NetworkService } from '../../../core/services/network.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { tipoOpNoun } from '../../../core/util/outbox-labels';

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
  private i18n = inject(I18nService);

  online = this.network.online;
  pending = this.sync.pendingCount;
  errors = this.sync.errorCount;
  errorTipos = this.sync.errorTipos;
  syncing = this.sync.syncing;

  state = computed<'offline' | 'syncing' | 'pending' | 'error' | 'clear'>(() => {
    if (this.errors() > 0) return 'error';
    if (!this.online()) return 'offline';
    if (this.syncing()) return 'syncing';
    if (this.pending() > 0) return 'pending';
    return 'clear';
  });

  text = computed(() => {
    const t = (s: string, p?: Record<string, string | number>) => this.i18n.t(s, p);
    switch (this.state()) {
      case 'error': {
        // BI2 — el conteo incluye TODO lo pendiente (error + pending/syncing). Un
        // "1 con problema" que esconde otras dos bitácoras atascadas en pending era
        // el peor mensaje posible.
        const otros = this.pending();
        if (otros > 0) return t('{n} sin enviar · toca para revisar', { n: this.errors() + otros });
        // BQ7 — si TODOS los errores son del mismo tipo, decir QUÉ tiene problema
        // ("3 echadas de combustible con problema") en vez del genérico "3 con problema".
        // El sustantivo (tipoOpNoun) es dato en español; el marco se traduce.
        const n = this.errors();
        const tipos = this.errorTipos();
        if (tipos.size === 1) {
          const tipo = tipos.keys().next().value as string;
          return t('{n} {noun} con problema · toca para revisar', { n, noun: tipoOpNoun(tipo, n) });
        }
        return t('{n} con problema · toca para revisar', { n });
      }
      case 'offline':
        return this.pending() > 0
          ? t('Sin señal · {n} se enviarán solos', { n: this.pending() })
          : t('Sin señal · todo guardado');
      case 'syncing':
        return t('Enviando…');
      case 'pending':
        return t('{n} pendientes de enviar', { n: this.pending() });
      default:
        return t('Todo enviado');
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
   *  no hace falta abrir la pantalla.
   *  BQ7 — si hay envíos EN ERROR, va directo al PRIMER envío con problema
   *  (outbox-detalle: contenido + error + Reintentar/Duplicar), no a la lista. */
  abrir(): void {
    if (this.pending() === 0 && this.errors() === 0) return;
    const primero = this.sync.errorFirstId();
    if (this.errors() > 0 && primero) {
      void this.router.navigate(['/pendientes', primero]);
      return;
    }
    void this.router.navigate(['/pendientes']);
  }
}
