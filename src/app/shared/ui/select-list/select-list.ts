import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SelectOption {
  id: string;
  label: string;
  /** U6 — thumbnail opcional (URL firmada); si viene, reemplaza el ícono. */
  image?: string | null;
}

/**
 * Tappable single-choice list (replaces native <select> — glove-friendly, big
 * targets, consistent with the rest of the app). For short lists like obra /
 * bodega. Icon + text on each row via OptionButton styling.
 */
@Component({
  selector: 'app-select-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './select-list.html',
  styleUrl: './select-list.scss',
})
export class SelectList {
  label = input<string>('');
  icon = input<string>('📍');
  options = input<SelectOption[]>([]);
  selectedId = input<string>('');
  picked = output<string>();
}
