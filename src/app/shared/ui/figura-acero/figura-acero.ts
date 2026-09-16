import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * BO10 — dibuja la figura de una pieza de acero por su código (el catálogo
 * `cartilla_figuras.svg` viene nulo; se dibuja aquí). Reutilizable en la rejilla de
 * selección (option-button), la lista de piezas y el detalle. Trazo con tokens (sin
 * hex), pensado para leerse pequeño (guantes/sol).
 */
@Component({
  selector: 'app-figura-acero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './figura-acero.html',
  styleUrl: './figura-acero.scss',
})
export class FiguraAcero {
  /** codigo de la figura: recta | l | u | estribo | gancho | z. */
  codigo = input.required<string>();

  /** path SVG (en un viewBox 0 0 100 60) según el código. */
  path = computed(() => FIGURAS[this.codigo()] ?? FIGURAS['recta']);
}

// Trazos en un lienzo 100×60. Simples y reconocibles; las cotas van aparte (el
// wizard muestra los tramos con sus valores en cm al lado).
const FIGURAS: Record<string, string> = {
  recta: 'M8 30 H92',
  l: 'M18 8 V44 H88',
  u: 'M18 8 V44 H82 V8',
  estribo: 'M20 12 H80 V48 H20 V12',
  gancho: 'M14 46 H86 M86 46 V22 Q86 12 76 14',
  z: 'M16 12 H60 L40 48 H84',
};
