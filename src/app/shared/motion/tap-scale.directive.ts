import { Directive, ElementRef, HostListener, inject, OnInit } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens } from './motion-tokens';

/**
 * CL2 (id `tap-scale`) — respuesta táctil de la app: las tarjetas clicables y los
 * botones grandes se encogen a .98 mientras se mantienen presionados y vuelven al
 * soltar (equivalente app del "levantar 2 px" del hover web, mock §f). Da sensación
 * de "pulsado" sin coste: solo `transform` con una transición corta (--motion-fast).
 *
 * Reduce-motion → no escala. Se suelta también al salir el dedo/puntero o al cancelarse
 * el gesto (scroll), para que no quede "hundido".
 *
 * Uso: `<article class="card" appTapScale>…</article>`.
 */
@Directive({
  selector: '[appTapScale]',
  standalone: true,
})
export class TapScaleDirective implements OnInit {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  ngOnInit(): void {
    if (this.motion.reducido()) return;
    const el = this.host.nativeElement;
    el.style.transition = `transform ${motionTokens.fast}ms ${motionTokens.easeOut}`;
    el.style.willChange = 'transform';
  }

  @HostListener('pointerdown')
  down(): void {
    if (this.motion.reducido()) return;
    this.host.nativeElement.style.transform = 'scale(0.98)';
  }

  @HostListener('pointerup')
  @HostListener('pointerleave')
  @HostListener('pointercancel')
  up(): void {
    this.host.nativeElement.style.transform = '';
  }
}
