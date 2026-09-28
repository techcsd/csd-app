import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface SelectOption {
  id: string;
  label: string;
  /** U6 — thumbnail opcional (URL firmada); si viene, reemplaza el ícono. */
  image?: string | null;
  /** Y2 — ícono por ítem (p. ej. 🏗️ obra / 🏢 bodega); si no, cae al `icon()` de la lista. */
  icon?: string;
  /** CA2 — agrupación opcional ("Mis obras" / "Otras obras"). Si NINGUNA opción trae
   *  `group`, la lista se pinta plana (retrocompatible con todos los usos actuales). */
  group?: string;
}

/** CA2 — un grupo de opciones (encabezado + sus opciones), para el render agrupado. */
interface OptionGroup {
  name: string;
  options: SelectOption[];
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
  /** CA2 — grupos que el usuario plegó/desplegó a mano (override del default:
   *  primer grupo abierto, el resto plegado). Clave = nombre del grupo. */
  private toggled = signal<Record<string, boolean>>({});

  visibles = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(q));
  });

  /** CA2 — grupos en orden de aparición con sus opciones visibles. Una lista sin
   *  `group` cae en un único grupo SIN nombre → se pinta plana (como siempre). */
  grupos = computed<OptionGroup[]>(() => {
    const out: OptionGroup[] = [];
    const idx = new Map<string, OptionGroup>();
    for (const o of this.visibles()) {
      const name = o.group ?? '';
      let g = idx.get(name);
      if (!g) {
        g = { name, options: [] };
        idx.set(name, g);
        out.push(g);
      }
      g.options.push(o);
    }
    return out;
  });

  /** CA2 — ¿este grupo está plegado? Buscando → todo desplegado; un grupo sin nombre
   *  nunca se pliega; sin override, el primer grupo abierto y los demás plegados. */
  estaColapsado(name: string, index: number): boolean {
    if (!name || this.query().trim()) return false;
    const t = this.toggled()[name];
    return t === undefined ? index > 0 : t;
  }

  toggle(name: string, index: number): void {
    if (!name) return;
    const cur = this.estaColapsado(name, index);
    this.toggled.update((m) => ({ ...m, [name]: !cur }));
  }

  onPick(id: string): void {
    this.picked.emit(id);
    this.query.set('');
  }
}
