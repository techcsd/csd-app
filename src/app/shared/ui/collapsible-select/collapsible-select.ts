import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SelectList, SelectOption } from '../select-list/select-list';

/**
 * AF10 — "selección colapsada + Cambiar". Envuelve `app-select-list`: mientras no
 * hay selección muestra la lista completa; al elegir, la lista se recoge y queda
 * solo el seleccionado con un botón "Cambiar". Reutilizable en entrada, salida,
 * sacar material y compra en ferretería (mismo patrón de almacén/origen).
 */
@Component({
  selector: 'app-collapsible-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectList],
  templateUrl: './collapsible-select.html',
  styleUrl: './collapsible-select.scss',
})
export class CollapsibleSelect {
  label = input<string>('');
  icon = input<string>('📍');
  options = input<SelectOption[]>([]);
  selectedId = input<string>('');
  /** Texto del botón para volver a abrir la lista. */
  cambiarLabel = input<string>('Cambiar');

  picked = output<string>();

  /** El usuario pidió cambiar (reabrir la lista aunque ya haya selección). */
  private reabierto = signal(false);

  readonly seleccionado = computed<SelectOption | null>(
    () => this.options().find((o) => o.id === this.selectedId()) ?? null,
  );

  /** Colapsado = hay una opción elegida y no se pidió reabrir. */
  readonly colapsado = computed(() => !!this.seleccionado() && !this.reabierto());

  onPicked(id: string): void {
    this.reabierto.set(false);
    this.picked.emit(id);
  }

  cambiar(): void {
    this.reabierto.set(true);
  }
}
