import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';
import { formatCedula } from '../../core/util/cedula';

/**
 * CG3 — máscara de cédula RD `000-0000000-0` MIENTRAS se escribe (y al pegar). Se
 * aplica sobre un `<input>` con `ngModel`: al teclear, reformatea el valor en el DOM
 * y RE-DISPARA un evento `input` para que `ngModelChange` reciba el valor ya con
 * formato (los guiones son solo visuales; el servidor normaliza la cédula).
 *
 * Nota (literal #127): *"while filling the cedula input the system must give format to
 * it in real time while im writing, thats a good ux."*
 *
 * Se desactiva con `[appCedulaMask]="false"` (p. ej. cuando el documento es un
 * pasaporte o cédula extranjera). Sin valor (`appCedulaMask` a secas) queda ACTIVA.
 * Driver por re-dispatch (no `setValue`) para no pelear con el binding de una vía
 * `[ngModel]="signal()"` + `(ngModelChange)`.
 */
@Directive({
  selector: '[appCedulaMask]',
  standalone: true,
})
export class CedulaMask {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  /** Activa/desactiva la máscara. `appCedulaMask` a secas ('') → activa. */
  enabled = input(true, {
    alias: 'appCedulaMask',
    transform: (v: boolean | string): boolean => (v === '' ? true : !!v),
  });

  @HostListener('input')
  onInput(): void {
    if (!this.enabled()) return;
    const input = this.el.nativeElement;
    const formatted = formatCedula(input.value);
    if (formatted === input.value) return; // ya formateado (incl. nuestro re-dispatch)
    input.value = formatted;
    try {
      input.setSelectionRange(formatted.length, formatted.length);
    } catch {
      /* algunos tipos de input no soportan selección: se ignora */
    }
    // Re-dispara un `input` real para que el ValueAccessor/ngModel adopte el valor
    // formateado como el modelo (la guarda `formatted === value` corta la recursión).
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
