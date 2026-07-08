import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Big −/+ counter for headcounts ("¿Cuántos hombres hay hoy?").
 * Two-way bound value; buttons are 56px so they work with gloves.
 */
@Component({
  selector: 'app-counter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
})
export class Counter {
  label = input<string>('');
  icon = input<string>('');
  value = model<number>(0);
  min = input<number>(0);
  max = input<number>(999);

  dec(): void {
    this.value.set(Math.max(this.min(), this.value() - 1));
  }

  inc(): void {
    this.value.set(Math.min(this.max(), this.value() + 1));
  }
}
