import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { SyncBar } from '../sync-bar/sync-bar';

/**
 * Temporary landing for a module whose flows arrive in a later milestone.
 * Shows what's coming so the nav map (User Flow §13) is walkable end-to-end
 * during M1. Replaced by the real flows in M2–M4.
 */
@Component({
  selector: 'app-module-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar],
  templateUrl: './module-placeholder.html',
  styleUrl: './module-placeholder.scss',
})
export class ModulePlaceholder {
  icon = input.required<string>();
  title = input.required<string>();
  actions = input<string[]>([]);

  private location = inject(Location);
  back(): void {
    this.location.back();
  }
}
