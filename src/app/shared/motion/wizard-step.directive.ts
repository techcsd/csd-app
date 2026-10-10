import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens } from './motion-tokens';

/**
 * CL2 (id `wizard-step`) — cada paso nuevo de un formulario por pasos entra con `mv-in`
 * (fundido + subida de 8 px). Ponla en el contenedor del paso; como el wizard
 * re-monta el contenido del paso al avanzar, la entrada corre sola en `ngAfterViewInit`.
 *
 * Solo `transform`/`opacity` (WAAPI). Reduce-motion → aparece sin animación.
 *
 * Uso: `@if (paso === 2) { <section appWizardStep>…</section> }`.
 */
@Directive({
  selector: '[appWizardStep]',
  standalone: true,
})
export class WizardStepDirective implements AfterViewInit {
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
