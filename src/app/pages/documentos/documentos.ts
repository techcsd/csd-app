import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/** CO12/CO13 — hub de "Documentos": Generar + Historial + Plantillas (ver). */
@Component({
  selector: 'app-documentos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, SyncBar, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './documentos.html',
  styleUrl: './documentos.scss',
})
export class DocumentosPage {
  private router = inject(Router);
  private location = inject(Location);

  abrir(route: string): void {
    void this.router.navigate([route]);
  }
  back(): void {
    this.location.back();
  }
}
