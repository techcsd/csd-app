import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { labelTipoVehiculo } from '../../../core/models/vehiculo-tipos.model';
import { Img } from '../img/img';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * V11 — consistent vehicle card for every selector/list. Photo (or 🚙
 * placeholder) on the left, placa + "tipo · km" clearly legible, and an
 * optional trailing slot (status badge / CTA) via <ng-content>.
 */
@Component({
  selector: 'app-vehiculo-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Img, TranslatePipe],
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
  alias = input<string | null | undefined>(null); // BV2 — nombre legible (Raykler)
  color = input<string | null | undefined>(null); // AT9
  anio = input<number | null | undefined>(null); // Z10
  selected = input(false);
  done = input(false);
  /** W7 — vehículo marcado como dato de prueba (solo lo reciben los admins). */
  esPrueba = input(false);

  /** P4 — etiqueta RD del tipo (automovil → "Automóvil / Sedán"). */
  tipoLabel = computed(() => (this.tipo() ? labelTipoVehiculo(this.tipo()) : ''));

  /** BV2/AT9 — titular = Alias (si Raykler lo puso) o Marca Modelo (cae a placa). */
  tieneNombre = computed(() => !!(this.alias()?.trim() || this.marca()?.trim() || this.modelo()?.trim()));
  titulo = computed(() => {
    const a = this.alias()?.trim();
    if (a) return a;
    return this.tieneNombre() ? [this.marca()?.trim(), this.modelo()?.trim()].filter(Boolean).join(' ') : this.placa();
  });
  /** BV2/AT9 — subtítulo. Con alias: solo la placa (el color no aporta a la identidad).
   *  Sin alias: Color · Placa (placa solo si ya hubo titular con nombre, para no repetirla). */
  subId = computed(() => {
    if (this.alias()?.trim()) return this.placa()?.trim() ?? '';
    const partes: string[] = [];
    if (this.color()?.trim()) partes.push(this.color()!.trim());
    if (this.tieneNombre() && this.placa()?.trim()) partes.push(this.placa().trim());
    return partes.join(' · ');
  });
}
