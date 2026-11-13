import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { reservarEspacioCompa } from '../../util/compa-safe-bottom';

/**
 * B5 — shared sticky footer for wizards / HOJAS. One place for the safe-area +
 * keyboard-aware sticky bar with an optional back button and a primary CTA, so
 * the pattern isn't copy-pasted per page. The primary button never shrinks (the
 * CTA is always visible — footer-btn-width gotcha handled here).
 *
 * DO1b — se usa en ~24 pantallas; reservar aquí el espacio de la burbuja de
 * Compa (en vez de pantalla por pantalla) cubre el patrón "footer de acción
 * fijo" de una sola vez (la regla general que pide DO-02).
 */
@Component({
  selector: 'app-wizard-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wizard-footer.html',
  styleUrl: './wizard-footer.scss',
})
export class WizardFooter {
  /** Back button label; empty hides the back button. */
  backLabel = input('');
  backDisabled = input(false);
  primaryLabel = input.required<string>();
  primaryDisabled = input(false);

  back = output<void>();
  primary = output<void>();

  constructor() {
    reservarEspacioCompa(76);
  }
}
