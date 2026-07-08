import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
} from '@angular/core';

/**
 * Full-screen success confirmation with a big check + haptic buzz so the
 * user is certain "ya quedó". When the capture is queued offline it shows
 * the warning tone with "Se enviará solo" instead of a false "sent".
 */
@Component({
  selector: 'app-big-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './big-confirm.html',
  styleUrl: './big-confirm.scss',
})
export class BigConfirm {
  title = input.required<string>();
  note = input<string>('');
  /** 'done' = synced (green), 'pending' = queued offline (amber). */
  tone = input<'done' | 'pending'>('done');
  buttonLabel = input<string>('Listo');

  dismissed = output<void>();

  constructor() {
    effect(() => {
      // Read title so the effect re-runs each time a new confirm is shown.
      this.title();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(this.tone() === 'done' ? [40, 60, 40] : 30);
      }
    });
  }
}
