import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TecTono } from '../../utils/tec-tono.util';

/** DA2 — chip "punto + palabra" reutilizable para situación/condición. */
@Component({
  selector: 'app-estado-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './estado-chip.html',
  styleUrl: './estado-chip.scss',
})
export class EstadoChip {
  label = input<string>('');
  tono = input<TecTono>('neutral');
}
