import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModulePlaceholder } from '../../shared/components/module-placeholder/module-placeholder';

@Component({
  selector: 'app-transporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModulePlaceholder],
  templateUrl: './transporte.html',
})
export class TransportePage {
  actions = [
    'Recibir y devolver el vehículo con fotos (responsabilidad)',
    'Ver tus rutas y conduces del día',
    'Marcar entregas de material con firma',
    'Reportar un problema del vehículo',
  ];
}
