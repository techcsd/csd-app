import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BienvenidaService } from '../../../core/services/bienvenida.service';
import { Idioma } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * CL3 (PROMPT-93 F5) — overlay de la bienvenida animada (copia exacta del mock
 * `mock-cl/CL3-bienvenida-app.dc.html`). Es SOLO presentación: toda la lógica (pasos,
 * efectos legales/técnicos, gate, relevo al tour) vive en `BienvenidaService`.
 *
 * 6 pantallas: (0) logo que se dibuja → (1) idioma → (2) saludo por rol con su escena
 * → (3) "sin señal" → (4) permisos en contexto + aceptación → (5) "¡todo listo!" → tour.
 * Barra de 5 segmentos + "Saltar" siempre visibles. Reduce-motion (clase global
 * `motion-reduced`) = mismas pantallas, sin movimiento. Nunca lanza error en WebView viejo.
 */
@Component({
  selector: 'app-bienvenida',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './bienvenida.html',
  styleUrl: './bienvenida.scss',
})
export class Bienvenida {
  bv = inject(BienvenidaService);

  /** Segmentos de progreso (1 lleno hasta el paso actual). */
  readonly segs = computed(() => {
    const s = this.bv.paso();
    return [1, 2, 3, 4, 5].map((n) => n <= s);
  });

  /** El chrome (barra + Saltar) se ve en los pasos 1..4 (no en el logo ni en "listo"). */
  readonly showChrome = computed(() => {
    const s = this.bv.paso();
    return s > 0 && s < 5;
  });

  elegir(code: Idioma): void {
    this.bv.elegirIdioma(code);
  }

  onPoliticas(ev: Event): void {
    this.bv.togglePoliticas((ev.target as HTMLInputElement).checked);
  }
}
