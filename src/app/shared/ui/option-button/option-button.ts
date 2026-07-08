import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Full-width selectable option used throughout the wizards (weather,
 * yes/no, activity picks). Icon + text always; selected state shows a
 * thick border + check so it never relies on color alone.
 */
@Component({
  selector: 'app-option-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './option-button.html',
  styleUrl: './option-button.scss',
})
export class OptionButton {
  icon = input<string>('');
  label = input.required<string>();
  selected = input<boolean>(false);
  /** Optional semantic accent, e.g. 'error' for an incident type. */
  tone = input<'default' | 'success' | 'warning' | 'error'>('default');

  pressed = output<void>();
}
