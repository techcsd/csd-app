import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * Aviso no intrusivo de borrador sin enviar: "Tienes un borrador de [fecha].
 * ¿Continuar o descartar?". El padre lo muestra con @if cuando hay borrador.
 */
@Component({
  selector: 'app-draft-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './draft-banner.html',
  styleUrl: './draft-banner.scss',
})
export class DraftBanner {
  /** updated_at (ms) del borrador. */
  fecha = input<number | null>(null);
  continuar = output<void>();
  descartar = output<void>();

  fmt(ms: number | null): string {
    return ms ? formatFechaMedia(new Date(ms).toISOString()) : '';
  }
}
