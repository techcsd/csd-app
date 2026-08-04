import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface SelectOption {
  id: string;
  label: string;
  /** U6 — thumbnail opcional (URL firmada); si viene, reemplaza el ícono. */
  image?: string | null;
  /** Y2 — ícono por ítem (p. ej. 🏗️ obra / 🏢 bodega); si no, cae al `icon()` de la lista. */
  icon?: string;
}

/**
 * Tappable single-choice list (replaces native <select> — glove-friendly, big
 * targets, consistent with the rest of the app). For short lists like obra /
 * bodega. Icon + text on each row via OptionButton styling.
 *
 * AF24.4 — `searchable`: muestra un buscador que filtra la lista en tiempo real
 * (para listados largos como las obras). Backward-compatible (default false).
 */
@Component({
  selector: 'app-select-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './select-list.html',
  styleUrl: './select-list.scss',
})
export class SelectList {
  label = input<string>('');
  icon = input<string>('📍');
  options = input<SelectOption[]>([]);
  selectedId = input<string>('');
  searchable = input<boolean>(false);
  searchPlaceholder = input<string>('Buscar…');
  picked = output<string>();

  query = signal('');

  visibles = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(q));
  });

  onPick(id: string): void {
    this.picked.emit(id);
    this.query.set('');
  }
}
