import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Shimmer placeholder shown while a screen loads, so the field user sees the
 * app is working instead of a blank page. Big, low-detail blocks that match the
 * chunky field UI.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
})
export class Skeleton {
  rows = input(5);
  items = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
