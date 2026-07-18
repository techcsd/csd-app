import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

/**
 * P3 — imagen con carga elegante (paridad con el `app-img` de la web):
 * reserva el espacio (aspect-ratio o alto fijo), muestra un shimmer/placeholder
 * hasta el evento `load`, hace **fade-in** al cargar, y usa `loading="lazy"` +
 * `decoding="async"`. Si falla o no hay `src`, muestra un glifo de reserva.
 * La app ya comprime/redimensiona las fotos; esto es SOLO la presentación.
 */
@Component({
  selector: 'app-img',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './img.html',
  styleUrl: './img.scss',
})
export class Img {
  /** URL de la imagen (o null → placeholder). */
  src = input<string | null>(null);
  alt = input('');
  /** CSS aspect-ratio, ej. "16 / 9" o "1 / 1" (reserva el espacio). */
  ratio = input<string | null>(null);
  /** Glifo mostrado cuando no hay imagen o falla la carga. */
  fallback = input('🖼️');
  /** object-fit de la imagen. */
  fit = input<'cover' | 'contain'>('cover');

  loaded = signal(false);
  errored = signal(false);

  mostrarImg = computed(() => !!this.src() && !this.errored());
  mostrarFallback = computed(() => !this.src() || this.errored());

  constructor() {
    // Reinicia el estado cuando cambia la fuente (p. ej. signed URL que llega tarde).
    effect(() => {
      this.src();
      this.loaded.set(false);
      this.errored.set(false);
    });
  }
}
