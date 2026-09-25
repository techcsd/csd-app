import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { EnProcesoService } from '../../core/services/en-proceso.service';
import { BitacoraService } from '../../core/services/bitacora.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Bitácora hub: parte diario, incidente, mis partes. */
@Component({
  selector: 'app-bitacora',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar, TranslatePipe],
  templateUrl: './bitacora.html',
  styleUrl: './bitacora.scss',
})
export class BitacoraPage {
  private router = inject(Router);
  private location = inject(Location);
  private enProceso = inject(EnProcesoService);
  private bitacora = inject(BitacoraService);

  // V1 — documentos en proceso de este módulo (borradores + envíos en cola).
  enProcesoCount = this.enProceso.counts;
  // BY4 — ¿puede ver las bitácoras de TODAS las obras? (gate server-side, mismo que
  // el tab "Todas" de Mis bitácoras). Muestra el tile "Bitácoras de las obras".
  puedeVerTodas = signal(false);

  constructor() {
    void this.enProceso.refresh();
    void this.bitacora.puedeVerOtrasBitacoras().then((p) => this.puedeVerTodas.set(p));
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  /** BY4 — abre Mis bitácoras directo en la vista "Todas" (bitácoras de las obras). */
  verBitacorasDeLasObras(): void {
    void this.router.navigate(['/bitacora/mis-partes'], { queryParams: { vista: 'todas' } });
  }

  back(): void {
    this.location.back();
  }
}
