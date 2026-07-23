import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { labelTipoVehiculo } from '../../../core/models/vehiculo-tipos.model';
import { Img } from '../img/img';

/**
 * V11 — consistent vehicle card for every selector/list. Photo (or 🚙
 * placeholder) on the left, placa + "tipo · km" clearly legible, and an
 * optional trailing slot (status badge / CTA) via <ng-content>.
 */
@Component({
  selector: 'app-vehiculo-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Img],
  templateUrl: './vehiculo-card.html',
  styleUrl: './vehiculo-card.scss',
})
export class VehiculoCard {
  fotoUrl = input<string | null>(null);
  placa = input('');
  tipo = input('');
  km = input<number | null>(null);
  marca = input('');
  modelo = input('');
  selected = input(false);
  done = input(false);
  /** W7 — vehículo marcado como dato de prueba (solo lo reciben los admins). */
  esPrueba = input(false);

  /** P4 — etiqueta RD del tipo (automovil → "Automóvil / Sedán"). */
  tipoLabel = computed(() => (this.tipo() ? labelTipoVehiculo(this.tipo()) : ''));
}
