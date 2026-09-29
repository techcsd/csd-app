import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** "Paso 2 de 5" + progress bar for the wizards. */
@Component({
  selector: 'app-step-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './step-bar.html',
  styleUrl: './step-bar.scss',
})
export class StepBar {
  current = input.required<number>();
  total = input.required<number>();

  pct = computed(() => Math.round((this.current() / this.total()) * 100));
  // CB — segmentos (hechos navy, actual naranja, pendientes gris). Solo piel.
  steps = computed(() => Array.from({ length: this.total() }, (_, i) => i + 1));
}
