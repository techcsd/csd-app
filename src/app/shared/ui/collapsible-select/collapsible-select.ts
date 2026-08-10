import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SelectList, SelectOption } from '../select-list/select-list';

/**
 * AF10 / AK6 — dropdown de verdad (cerrado por defecto). Envuelve `app-select-list`:
 *  - Sin selección → un botón "trigger" cerrado ("Seleccionar…"); el listado NO
 *    aparece hasta que el usuario lo toca (AK6 — antes se mostraba abierto).
 *  - Al tocar el trigger → abre la lista (con buscador si aplica).
 *  - Al elegir → se recoge y queda solo el seleccionado + botón "Cambiar".
 *  - "Cambiar" reabre la lista. Reutilizable en todo el wizard de conduce y en
 *    los selectores de vehículo/obra/despachante.
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
  /** AK6 — texto del trigger cerrado cuando no hay selección. */
  placeholder = input<string>('');
  /** AF24.4 — pasa el buscador de `select-list` (listas largas: obras). */
  searchable = input<boolean>(false);
  searchPlaceholder = input<string>('Buscar…');

  picked = output<string>();

  /** AK6 — la lista está abierta (el usuario tocó el trigger o "Cambiar"). */
  private abierto = signal(false);

  readonly seleccionado = computed<SelectOption | null>(
    () => this.options().find((o) => o.id === this.selectedId()) ?? null,
  );

  /** Colapsado = hay una opción elegida y la lista no está abierta (chip + Cambiar). */
  readonly colapsado = computed(() => !!this.seleccionado() && !this.abierto());

  /** AK6 — cerrado = sin selección y sin abrir (muestra el trigger). */
  readonly cerrado = computed(() => !this.seleccionado() && !this.abierto());

  /** Texto del trigger cerrado. */
  readonly triggerLabel = computed(
    () => this.placeholder() || (this.label() ? `Seleccionar ${this.label().toLowerCase()}` : 'Seleccionar…'),
  );

  abrir(): void {
    this.abierto.set(true);
  }

  onPicked(id: string): void {
    this.abierto.set(false);
    this.picked.emit(id);
  }

  cambiar(): void {
    this.abierto.set(true);
  }
}
