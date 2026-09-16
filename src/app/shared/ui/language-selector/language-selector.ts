import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService, IDIOMAS, Idioma } from '../../../core/i18n/i18n.service';

/**
 * BR7 — selector de idioma reutilizable (lista con el nombre NATIVO de cada
 * idioma). Se usa en Perfil y en la pantalla de PIN (donde un chofer/encargado
 * nuevo lo necesita antes de entrar). Cambio inmediato (signals), sin recargar.
 */
@Component({
  selector: 'app-language-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './language-selector.html',
  styleUrl: './language-selector.scss',
})
export class LanguageSelector {
  private i18n = inject(I18nService);
  idiomas = IDIOMAS;
  actual = this.i18n.idioma;

  elegir(code: Idioma): void {
    void this.i18n.setIdioma(code);
  }
}
