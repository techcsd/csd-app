import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/** CO13/CO11 — hub de "Legal": Expedientes + Contratos. */
@Component({
  selector: 'app-legal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, SyncBar, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
})
export class LegalPage {
  private router = inject(Router);
  private location = inject(Location);

  abrir(route: string): void {
    void this.router.navigate([route]);
  }
  back(): void {
    this.location.back();
  }
}
