import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModulePlaceholder } from '../../shared/components/module-placeholder/module-placeholder';

@Component({
  selector: 'app-bitacora',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModulePlaceholder],
  templateUrl: './bitacora.html',
})
export class BitacoraPage {
  actions = [
    'Hacer el parte diario paso a paso, con fotos',
    'Reportar un incidente o accidente',
    'Ver tus partes enviados',
  ];
}
