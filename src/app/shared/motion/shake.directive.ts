import { Directive, ElementRef, inject, Input, OnChanges, SimpleChanges } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';

/**
 * CL2 (id `error-shake`) — un error de validación hace que el campo/paso TIEMBLE una
 * sola vez (±6 px, 220 ms) y nada más (sin bucles, sin color extra — el estado de error
 * lo pinta el CSS). Dispara cada vez que la entrada pasa a un valor "verdadero" nuevo:
 * usa un contador que incrementas al fallar, o el propio mensaje de error.
 *
 * Solo `transform` (WAAPI). Reduce-motion → no tiembla.
 *
 * Uso: `<div class="field" [appShake]="errorCount">…</div>` (incrementa `errorCount`
 * en cada intento fallido), o `[appShake]="!!errorMsg"` con un toggle.
 */
@Directive({
  selector: '[appShake]',
  standalone: true,
})
export class ShakeDirective implements OnChanges {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  /** Al cambiar a un valor truthy nuevo, tiembla una vez. */
  @Input({ required: true }) appShake: unknown;

  ngOnChanges(changes: SimpleChanges): void {
    const c = changes['appShake'];
    if (!c || c.firstChange) return;
    if (!c.currentValue || c.currentValue === c.previousValue) return;
    if (this.motion.reducido()) return;
    this.host.nativeElement.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
  }
}
