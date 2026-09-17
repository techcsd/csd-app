import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IdiomaOnboardingService } from '../../../core/i18n/idioma-onboarding.service';
import { Idioma } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

interface OpcionIdioma {
  code: Idioma;
  nativo: string;
  bandera: string;
}

/**
 * BS4 — diálogo de PRIMER INGRESO de idioma (modal a pantalla completa,
 * bloqueante). Sale UNA vez, tras el primer login y antes del home, cuando el
 * usuario nunca ha elegido idioma (ni en la app ni en la web). Tres opciones con
 * nombre NATIVO + bandera, targets ≥56 px, preseleccionadas al idioma del
 * dispositivo. Sin "Cancelar": elegir es obligatorio (siempre hay preselección).
 *
 * La lógica (cuándo mostrar, capacidad, sellado, offline) vive en
 * IdiomaOnboardingService — este componente es solo la presentación.
 */
@Component({
  selector: 'app-language-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './language-onboarding.html',
  styleUrl: './language-onboarding.scss',
})
export class LanguageOnboarding {
  private onboarding = inject(IdiomaOnboardingService);

  readonly opciones: OpcionIdioma[] = [
    { code: 'es', nativo: 'Español', bandera: '🇩🇴' },
    { code: 'en', nativo: 'English', bandera: '🇺🇸' },
    { code: 'ht', nativo: 'Kreyòl ayisyen', bandera: '🇭🇹' },
  ];

  /** Elegido en el diálogo (arranca en la preselección del dispositivo). */
  seleccion = signal<Idioma>(this.onboarding.preseleccion());
  guardando = signal(false);

  elegir(code: Idioma): void {
    this.seleccion.set(code);
  }

  async confirmar(): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.onboarding.confirmar(this.seleccion());
    } finally {
      this.guardando.set(false);
    }
  }
}
