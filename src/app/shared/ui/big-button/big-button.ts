import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Home-screen tile. One button = one job. Big icon + short label,
 * >= 25% screen height in a 2x2 grid. Icon is an emoji or short glyph
 * so it renders offline with no asset dependency.
 */
@Component({
  selector: 'app-big-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './big-button.html',
  styleUrl: './big-button.scss',
})
export class BigButton {
  icon = input.required<string>();
  label = input.required<string>();
  /** Optional pending-count badge (e.g. items to sync / tasks pending). */
  badge = input<number | null>(null);
  /** CSS color for the icon chip; defaults to brand orange. */
  tint = input<string>('var(--color-primary)');

  pressed = output<void>();
}
