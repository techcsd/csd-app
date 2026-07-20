import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Q7 — cabecera mínima con botón "← Salir" SIEMPRE visible en los wizards, para
 * que el usuario pueda salir desde cualquier paso sin cerrar la app (en iOS no
 * hay back físico). Emite `exit`; la página decide el confirm (borrador / sin
 * guardar) y a dónde navegar.
 */
@Component({
  selector: 'app-wizard-exit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wizard-exit.html',
  styleUrl: './wizard-exit.scss',
})
export class WizardExit {
  /** Texto opcional junto a la flecha (título del wizard). */
  title = input('');
  exit = output<void>();
}
