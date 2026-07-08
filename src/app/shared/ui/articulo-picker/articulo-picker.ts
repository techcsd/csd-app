import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticuloCat } from '../../../core/models/inventario.model';

/**
 * Browse-and-tap material picker. The list is the primary way to choose (so a
 * user who doesn't know the exact name just scrolls and taps); the filter box
 * is optional, for long catalogs. Already-added items are hidden.
 */
@Component({
  selector: 'app-articulo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './articulo-picker.html',
  styleUrl: './articulo-picker.scss',
})
export class ArticuloPicker {
  articulos = input<ArticuloCat[]>([]);
  exclude = input<string[]>([]);
  picked = output<ArticuloCat>();

  query = signal('');

  visible = computed(() => {
    const ex = new Set(this.exclude());
    const q = this.query().toLowerCase().trim();
    return this.articulos()
      .filter((a) => !ex.has(a.id))
      .filter((a) => !q || a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q));
  });
}
