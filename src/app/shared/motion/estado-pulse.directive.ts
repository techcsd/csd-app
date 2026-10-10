import { Directive, ElementRef, inject, Input, OnChanges, SimpleChanges } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens } from './motion-tokens';

/**
 * CL2 (id `estado-pulse`) — cuando el ESTADO de un chip cambia (p. ej. "Pendiente" →
 * "Aprobada"), el chip da un pulso corto de escala (1 → 1.12 → 1). El color lo cambia
 * el CSS de la clase de estado; esta directiva solo aporta el pulso. Sirve igual en
 * tablas, tarjetas y fichas.
 *
 * Solo `transform` (WAAPI). No pulsa en el primer render (solo en cambios reales).
 * Reduce-motion → sin pulso.
 *
 * Uso: `<span class="chip" [appEstadoPulse]="estado">{{ estado }}</span>`.
 */
@Directive({
  selector: '[appEstadoPulse]',
  standalone: true,
})
export class EstadoPulseDirective implements OnChanges {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  /** Valor de estado; al cambiar dispara el pulso. */
  @Input({ required: true }) appEstadoPulse: unknown;

  ngOnChanges(changes: SimpleChanges): void {
    const c = changes['appEstadoPulse'];
    if (!c || c.firstChange || c.previousValue === c.currentValue) return;
    if (this.motion.reducido()) return;
    this.host.nativeElement.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: motionTokens.slow, easing: motionTokens.easeOut },
    );
  }
}
