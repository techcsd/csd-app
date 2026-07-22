import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { EnProcesoService } from '../../core/services/en-proceso.service';

/** Bitácora hub: parte diario, incidente, mis partes. */
@Component({
  selector: 'app-bitacora',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar],
  templateUrl: './bitacora.html',
  styleUrl: './bitacora.scss',
})
export class BitacoraPage {
  private router = inject(Router);
  private location = inject(Location);
  private enProceso = inject(EnProcesoService);

  // V1 — documentos en proceso de este módulo (borradores + envíos en cola).
  enProcesoCount = this.enProceso.counts;

  constructor() {
    void this.enProceso.refresh();
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  back(): void {
    this.location.back();
  }
}
