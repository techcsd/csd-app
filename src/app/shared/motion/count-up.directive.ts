import { Directive, ElementRef, inject, Input, OnChanges, SimpleChanges } from '@angular/core';
import { MotionService } from '../../core/services/motion.service';
import { COUNTUP_MS } from './motion-tokens';

/**
 * CL2 (id `kpi-countup`) — anima un número hasta su valor (KPI que "cuentan hacia
 * arriba", 600 ms). Escribe en el `textContent` del host con `requestAnimationFrame`
 * (no toca el layout). Formatea con separador de miles (es-DO); `decimales` para
 * valores con fracción.
 *
 * Reduce-motion (SO o ajuste) → escribe el valor final de una vez (sin conteo).
 * Al cambiar el valor vuelve a contar desde el anterior (p. ej. al refrescar un panel).
 *
 * Uso: `<span [appCountUp]="total"></span>` · `<span [appCountUp]="litros" [decimales]="1">`.
 */
@Directive({
  selector: '[appCountUp]',
  standalone: true,
})
export class CountUpDirective implements OnChanges {
  private host = inject(ElementRef<HTMLElement>);
  private motion = inject(MotionService);

  @Input({ required: true }) appCountUp = 0;
  @Input() decimales = 0;

  private frame: number | null = null;
  private current = 0;

  ngOnChanges(changes: SimpleChanges): void {
    const target = Number(this.appCountUp) || 0;
    const from = changes['appCountUp']?.firstChange ? 0 : this.current;
    if (this.motion.reducido()) {
      this.render(target);
      this.current = target;
      return;
    }
    this.cancel();
    const start = performance.now();
    const delta = target - from;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNTUP_MS);
      // ease-out suave (mismo perfil que --ease-out, sin medir el cubic-bezier exacto).
      const eased = 1 - Math.pow(1 - t, 3);
      this.current = from + delta * eased;
      this.render(this.current);
      if (t < 1) {
        this.frame = requestAnimationFrame(tick);
      } else {
        this.current = target;
        this.render(target);
        this.frame = null;
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private render(value: number): void {
    this.host.nativeElement.textContent = value.toLocaleString('es-DO', {
      minimumFractionDigits: this.decimales,
      maximumFractionDigits: this.decimales,
    });
  }

  private cancel(): void {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
