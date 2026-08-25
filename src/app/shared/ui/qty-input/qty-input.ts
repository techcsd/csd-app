import { ChangeDetectionStrategy, Component, effect, input, model, signal } from '@angular/core';
import { parseNumeroFlexible } from '../../../core/util/numero';

/**
 * AX7 — input de CANTIDAD a prueba de "dedazos", compartido por todos los
 * carritos (conduce, requisición, ferretería, devolución, entrada/salida de
 * inventario). Reemplaza el patrón viejo `type="number"` + `.filter(cant > 0)`
 * que BORRABA el item al vaciar el "1".
 *
 * Comportamiento (uno solo para toda la app):
 *  · Permite el estado VACÍO mientras se edita — el item NUNCA se borra al
 *    vaciar el campo (borrar es un gesto explícito: la ✕ / swipe del padre).
 *  · Al enfocar SELECCIONA TODO → tocar "1" y teclear "25" da 25, no 125.
 *  · Al salir del campo (blur), si quedó vacío o ≤ 0 → revierte al último valor
 *    válido (nunca deja el renglón en 0/vacío).
 *  · Teclado numérico (`inputmode="decimal"`), decimales opcionales por unidad.
 *  · Botones ± que respetan el mínimo (>0) y el tope opcional.
 *  · Parseo locale-flexible (reutiliza `parseNumeroFlexible`, la misma base de AW3).
 * El valor emitido a `(valueChange)` es SIEMPRE un número válido → el padre
 * guarda el valor bueno en el borrador (AE9), no el vacío transitorio.
 */
@Component({
  selector: 'app-qty-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qty-input.html',
  styleUrl: './qty-input.scss',
})
export class QtyInput {
  /** Cantidad comprometida (two-way). Nunca se emite vacío ni 0 destructivo. */
  value = model<number>(1);
  /** Tope superior (p.ej. stock disponible). null / Infinity = sin tope. */
  max = input<number | null>(null);
  /** Permite fracciones (según la unidad del artículo — TODO AU13: por unidad). */
  decimales = input(true);
  /** Piso de los botones ± y valor de reversión si queda vacío (>0). */
  min = input(1);
  /** Muestra los botones ± (por defecto sí). */
  steppers = input(true);
  ariaLabel = input('Cantidad');

  /** Texto crudo mientras se edita (permite vacío transitorio sin destruir el item). */
  raw = signal<string>('');
  /** Último valor válido, para revertir si el campo queda vacío/≤0. */
  private lastGood = 1;
  private editing = false;

  constructor() {
    // Mantiene el texto en sync con el `value` entrante mientras NO se edita
    // (p.ej. cuando el padre re-clampa por stock o recarga el borrador).
    effect(() => {
      const v = this.value();
      if (this.editing) return;
      if (v > 0) this.lastGood = v;
      this.raw.set(this.fmt(v));
    });
  }

  private fmt(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '';
    return this.decimales() ? String(Number(n.toFixed(2))) : String(Math.round(n));
  }

  private clamp(n: number): number {
    let v = this.decimales() ? n : Math.round(n);
    if (v < 0) v = 0;
    const mx = this.max();
    if (mx != null && Number.isFinite(mx) && v > mx) v = mx;
    return v;
  }

  onFocus(el: HTMLInputElement): void {
    this.editing = true;
    // Selecciona todo tras el frame de foco (iOS/Android colocan el cursor si no).
    queueMicrotask(() => el.select());
  }

  onInput(str: string): void {
    this.raw.set(str);
    const n = parseNumeroFlexible(str, 'decimal');
    if (n == null) return; // vacío transitorio: NO tocar value → el item sobrevive
    this.value.set(this.clamp(n));
  }

  onBlur(): void {
    this.editing = false;
    const n = parseNumeroFlexible(this.raw(), 'decimal');
    if (n == null || this.clamp(n) <= 0) {
      const revert = this.lastGood > 0 ? this.lastGood : this.min();
      this.lastGood = revert;
      this.value.set(revert);
      this.raw.set(this.fmt(revert));
      return;
    }
    const v = this.clamp(n);
    this.lastGood = v;
    this.value.set(v);
    this.raw.set(this.fmt(v));
  }

  step(delta: number): void {
    const base = this.value() || this.lastGood || this.min();
    const v = this.clamp(Math.max(this.min(), base + delta));
    this.lastGood = v;
    this.value.set(v);
    this.raw.set(this.fmt(v));
  }

  atMin(): boolean {
    return this.value() <= this.min();
  }
  atMax(): boolean {
    const mx = this.max();
    return mx != null && Number.isFinite(mx) && this.value() >= mx;
  }
}
