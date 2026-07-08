import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type SyncState = 'pending' | 'syncing' | 'done' | 'error';

/** Per-record sync status chip. Icon + text (never color alone). */
@Component({
  selector: 'app-sync-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sync-badge.html',
  styleUrl: './sync-badge.scss',
})
export class SyncBadge {
  state = input.required<SyncState>();
  retry = output<void>();

  private readonly labels: Record<SyncState, { icon: string; text: string }> = {
    pending: { icon: '⏳', text: 'Se enviará solo' },
    syncing: { icon: '🔄', text: 'Enviando…' },
    done: { icon: '✅', text: 'Enviado' },
    error: { icon: '⚠️', text: 'Toca para reintentar' },
  };

  meta = computed(() => this.labels[this.state()]);
}
