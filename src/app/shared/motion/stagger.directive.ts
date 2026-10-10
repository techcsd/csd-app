import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens, STAGGER_MAX, STAGGER_STEP_MS } from './motion-tokens';

/**
 * CL2 (id `lista`) — escalonado de los hijos directos del host al **primer render**:
 * cada fila entra 30 ms después de la anterior, máximo 8 (el resto aparece sin retraso).
 * Solo `transform`/`opacity` vía la Web Animations API (barato, no provoca reflow).
 *
 * Solo primera carga: corre una vez en `ngAfterViewInit`; re-render/filtrado posterior
 * no re-animan (así una lista que se filtra no "parpadea"). Reduce-motion (SO o ajuste)
 * → sin movimiento, los hijos quedan en su estado final al instante.
 *
 * Uso: `<ul appStagger><li *ngFor="…">…</li></ul>`.
 */
@Directive({
  selector: '[appStagger]',
  standalone: true,
})
export class StaggerDirective implements AfterViewInit {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  ngAfterViewInit(): void {
    if (this.motion.reducido()) return;
    const children = Array.from(this.host.nativeElement.children) as HTMLElement[];
    const easing = motionTokens.easeOut;
    const duration = motionTokens.base;
    children.slice(0, STAGGER_MAX).forEach((el, i) => {
      // `fill:backwards` mantiene el estado inicial (opacity 0) durante el delay,
      // así no hay destello antes de que a la fila le toque entrar.
      el.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration, delay: i * STAGGER_STEP_MS, easing, fill: 'backwards' },
      );
    });
  }
}
