import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';

/** Solicitudes hub: pedir materiales, mis solicitudes. */
@Component({
  selector: 'app-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar],
  templateUrl: './solicitudes.html',
  styleUrl: './solicitudes.scss',
})
export class SolicitudesPage {
  private router = inject(Router);
  private location = inject(Location);

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
