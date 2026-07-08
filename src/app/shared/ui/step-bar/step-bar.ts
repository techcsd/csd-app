import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** "Paso 2 de 5" + progress bar for the wizards. */
@Component({
  selector: 'app-step-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './step-bar.html',
  styleUrl: './step-bar.scss',
})
export class StepBar {
  current = input.required<number>();
  total = input.required<number>();

  pct = computed(() => Math.round((this.current() / this.total()) * 100));
}
