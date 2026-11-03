import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Las 3 secciones del módulo "Demo" (DG5): Misiones (= /practica, sin renombrar
 *  la ruta), Mi progreso y Escenarios. */
export type DemoTab = 'misiones' | 'progreso' | 'escenarios';

/**
 * DG5 — segmented control de navegación entre las 3 pantallas del módulo Demo.
 * Un solo componente reusado por las 3 (en vez de triplicar el markup).
 */
@Component({
  selector: 'app-demo-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './demo-tabs.html',
  styleUrl: './demo-tabs.scss',
})
export class DemoTabs {
  activo = input.required<DemoTab>();
}
