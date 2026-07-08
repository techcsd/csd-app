import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModulePlaceholder } from '../../shared/components/module-placeholder/module-placeholder';

@Component({
  selector: 'app-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModulePlaceholder],
  templateUrl: './inventario.html',
})
export class InventarioPage {
  actions = [
    'Ver las existencias de tu bodega',
    'Registrar salida de material (consumo)',
    'Recibir material de un conduce',
  ];
}
