import { Directive, ElementRef, inject, Input, OnChanges } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { motionTokens } from './motion-tokens';

/**
 * CL2 (id `tab-indicator`) — el indicador de pestañas/segmentos se DESLIZA bajo la
 * opción activa (220 ms) en vez de saltar. Se pone en el elemento-indicador (una barra
 * posicionada `absolute` dentro del contenedor de pestañas) y recibe el elemento del
 * botón activo; calcula su `offsetLeft`/`offsetWidth` y anima `transform`+`width`.
 *
 * Solo `transform`/`opacity`(+width, barato en una barra aislada) vía WAAPI.
 * Reduce-motion → se coloca sin deslizar.
 *
 * Uso:
 * ```
 * <div class="tabs" style="position:relative">
 *   <button #a (click)="sel='a'">Activas</button>
 *   <button #b (click)="sel='b'">Historial</button>
 *   <span class="tabs__ind" [appTabIndicator]="sel==='a' ? a : b"></span>
 * </div>
 * ```
 */
@Directive({
  selector: '[appTabIndicator]',
  standalone: true,
})
export class TabIndicatorDirective implements OnChanges {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  /** Elemento del botón/segmento activo (o su rect) al que seguir. */
  @Input({ required: true }) appTabIndicator: HTMLElement | null = null;

  private first = true;

  ngOnChanges(): void {
    const target = this.appTabIndicator;
    if (!target) return;
    const el = this.host.nativeElement;
    const left = target.offsetLeft;
    const width = target.offsetWidth;

    // Primera colocación o reduce-motion: sin deslizar.
    if (this.first || this.motion.reducido()) {
      this.first = false;
      el.style.transform = `translateX(${left}px)`;
      el.style.width = `${width}px`;
      return;
    }

    const prevLeft = parseFloat(el.style.transform.replace(/[^\d.-]/g, '')) || 0;
    const prevWidth = parseFloat(el.style.width) || width;
    el.style.transform = `translateX(${left}px)`;
    el.style.width = `${width}px`;
    el.animate(
      [
        { transform: `translateX(${prevLeft}px)`, width: `${prevWidth}px` },
        { transform: `translateX(${left}px)`, width: `${width}px` },
      ],
      { duration: motionTokens.base, easing: motionTokens.easeOut },
    );
  }
}
