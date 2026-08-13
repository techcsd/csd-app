import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SelectList, SelectOption } from '../select-list/select-list';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';

/**
 * AF10 / AK6 — dropdown de verdad (cerrado por defecto). AO — al abrir, el listado
 * NO empuja el flujo de la página: sale en una **hoja inferior (modal deslizable)**
 * por encima de la pantalla y se cierra al elegir (o tocar el fondo / ✕).
 *  - Sin selección → un botón "trigger" cerrado ("Seleccionar…").
 *  - Al tocarlo → abre la hoja con la lista (con buscador si aplica).
 *  - Al elegir → se cierra la hoja y queda el chip seleccionado + botón "Cambiar".
 *  - "Cambiar" reabre la hoja. Reutilizable en todo el wizard de conduce y en los
 *    selectores de vehículo/obra/despachante.
 */
@Component({
  selector: 'app-collapsible-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectList, BottomSheet],
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

  /** AO — la hoja modal con la lista está abierta. */
  readonly abierto = signal(false);

  readonly seleccionado = computed<SelectOption | null>(
    () => this.options().find((o) => o.id === this.selectedId()) ?? null,
  );

  /** Texto del trigger cerrado. */
  readonly triggerLabel = computed(
    () => this.placeholder() || (this.label() ? `Seleccionar ${this.label().toLowerCase()}` : 'Seleccionar…'),
  );

  /** Título de la hoja modal. */
  readonly tituloSheet = computed(
    () => this.label() || this.placeholder() || 'Seleccionar',
  );

  abrir(): void {
    this.abierto.set(true);
  }

  /** AO — cerrar sin elegir (fondo / ✕). */
  cerrarSheet(): void {
    this.abierto.set(false);
  }

  onPicked(id: string): void {
    this.abierto.set(false);
    this.picked.emit(id);
  }

  cambiar(): void {
    this.abierto.set(true);
  }
}
