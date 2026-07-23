import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * W7 — switch deslizable reutilizable (patrón de "Dato de prueba" para admins).
 * El padre controla el estado con `checked` y recibe el nuevo valor por
 * `checkedChange`. Objetivo táctil ≥56px (regla de targets grandes).
 */
@Component({
  selector: 'app-toggle-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toggle-switch.html',
  styleUrl: './toggle-switch.scss',
})
export class ToggleSwitch {
  checked = input<boolean>(false);
  label = input<string>('');
  hint = input<string>('');
  checkedChange = output<boolean>();

  toggle(): void {
    this.checkedChange.emit(!this.checked());
  }
}
