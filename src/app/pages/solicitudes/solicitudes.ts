import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModulePlaceholder } from '../../shared/components/module-placeholder/module-placeholder';

@Component({
  selector: 'app-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModulePlaceholder],
  templateUrl: './solicitudes.html',
})
export class SolicitudesPage {
  actions = [
    'Pedir materiales desde la obra',
    'Seguir el estado de tus solicitudes',
  ];
}
