import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';

/** Inventario hub: existencias, salida, entrada. */
@Component({
  selector: 'app-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
})
export class InventarioPage {
  private router = inject(Router);
  private location = inject(Location);

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
