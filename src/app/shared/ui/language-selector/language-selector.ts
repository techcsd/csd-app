import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService, Idioma } from '../../../core/i18n/i18n.service';

/**
 * BR7/BT2 — selector de idioma reutilizable (lista con el nombre NATIVO de cada
 * idioma). Se usa en Perfil. Cambio inmediato (signals), sin recargar. BT2: cada
 * idioma muestra su estado real — "beta · cubre n%" si aún no cubre todo, o
 * "próximamente" (deshabilitado) si está muy por debajo (Kreyòl).
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
  actual = this.i18n.idioma;
  idiomas = computed(() => this.i18n.estadoIdiomas());

  elegir(code: Idioma, deshabilitado: boolean): void {
    if (deshabilitado) return;
    void this.i18n.setIdioma(code);
  }
}
