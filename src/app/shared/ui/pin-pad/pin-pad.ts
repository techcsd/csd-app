import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

/**
 * Big numeric keypad for the 4-digit PIN. Dots show progress; emits
 * `completed` when the PIN reaches its length. Keys are 72px for gloves.
 */
@Component({
  selector: 'app-pin-pad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pin-pad.html',
  styleUrl: './pin-pad.scss',
})
export class PinPad {
  value = model<string>('');
  length = input<number>(4);
  completed = output<string>();

  keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  dots = computed(() => Array.from({ length: this.length() }, (_, i) => i < this.value().length));

  press(k: string): void {
    if (this.value().length >= this.length()) return;
    const next = this.value() + k;
    this.value.set(next);
    if (next.length === this.length()) this.completed.emit(next);
  }

  back(): void {
    this.value.set(this.value().slice(0, -1));
  }
}
