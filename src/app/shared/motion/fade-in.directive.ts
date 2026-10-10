import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens } from './motion-tokens';

/**
 * CL2 (id `skeleton-fade`) — el contenido real entra con un fundido + subida de 8 px
 * cuando reemplaza al esqueleto (patrón "cargando → contenido"). Ponla en el bloque
 * que se pinta cuando llegan los datos (dentro del `@else`/`@if (cargado)`): al montar,
 * hace el fundido una vez.
 *
 * Solo `transform`/`opacity` (WAAPI). Reduce-motion → aparece sin animación.
 *
 * Uso: `@if (cargando) { <app-skeleton/> } @else { <div appFadeIn>…</div> }`.
 */
@Directive({
  selector: '[appFadeIn]',
  standalone: true,
})
export class FadeInDirective implements AfterViewInit {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  ngAfterViewInit(): void {
    if (this.motion.reducido()) return;
    this.host.nativeElement.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: motionTokens.base, easing: motionTokens.easeOut, fill: 'backwards' },
    );
  }
}
