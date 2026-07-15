import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * V11 — consistent vehicle card for every selector/list. Photo (or 🚙
 * placeholder) on the left, placa + "tipo · km" clearly legible, and an
 * optional trailing slot (status badge / CTA) via <ng-content>.
 */
@Component({
  selector: 'app-vehiculo-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
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
}
