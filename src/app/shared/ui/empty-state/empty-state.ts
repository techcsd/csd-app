import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Shared empty-state block. No screen with an empty list is a dead end
 * (R11): show what the list is for, how that content gets created, and an
 * optional call to action. Icon is an emoji so it renders offline.
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  icon = input<string>('📭');
  title = input.required<string>();
  message = input<string>('');
  /** When set, renders a primary CTA button that emits `action`. */
  ctaLabel = input<string>('');
  /** Optional secondary/ghost CTA. */
  secondaryLabel = input<string>('');

  action = output<void>();
  secondaryAction = output<void>();
}
