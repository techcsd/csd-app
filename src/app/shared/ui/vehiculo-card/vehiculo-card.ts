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
  color = input<string | null | undefined>(null); // AT9
  anio = input<number | null | undefined>(null); // Z10
  selected = input(false);
  done = input(false);
  /** W7 — vehículo marcado como dato de prueba (solo lo reciben los admins). */
  esPrueba = input(false);

  /** P4 — etiqueta RD del tipo (automovil → "Automóvil / Sedán"). */
  tipoLabel = computed(() => (this.tipo() ? labelTipoVehiculo(this.tipo()) : ''));

  /** AT9 — titular = Marca Modelo (cae a placa si no hay nombre). */
  tieneNombre = computed(() => !!(this.marca()?.trim() || this.modelo()?.trim()));
  titulo = computed(() =>
    this.tieneNombre() ? [this.marca()?.trim(), this.modelo()?.trim()].filter(Boolean).join(' ') : this.placa(),
  );
  /** AT9 — subtítulo = Color · Placa (solo las partes presentes; placa solo si ya
   *  hubo titular con nombre, para no repetirla). */
  subId = computed(() => {
    const partes: string[] = [];
    if (this.color()?.trim()) partes.push(this.color()!.trim());
    if (this.tieneNombre() && this.placa()?.trim()) partes.push(this.placa().trim());
    return partes.join(' · ');
  });
}
