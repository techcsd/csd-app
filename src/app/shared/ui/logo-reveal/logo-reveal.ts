import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LogoRevealService } from '../../../core/services/logo-reveal.service';
import { MotionService } from '../../../core/services/motion.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * CM2 — "logo al entrar" (variante A · Trazo, del mock `Logo.dc.html`). Velo navy a
 * pantalla completa que se monta una vez por arranque (login / PIN) sobre lo que venga
 * cargando; NO bloquea nada. Variante A: el símbolo SD se dibuja de un solo trazo
 * (stroke-dashoffset), el punto naranja aparece con rebote, "CSD APP" se descubre y una
 * barra naranja se llena (mock Main, columna del teléfono). Toca para saltar.
 *
 * - Solo `transform`/`opacity` + `stroke-dashoffset` (el trazo). Sin librerías.
 * - `MotionService.reducido()` (SO o ajuste Perfil › Animaciones) → logo ESTÁTICO +
 *   fundido, sin dibujo ni movimiento ni vibración.
 * - WebView viejo: el CSS cae a estado final; nunca un error (es puro CSS).
 * - Vibración corta al final (solo nativo; se salta con reduce-motion).
 * - Tiempos/curvas copiados del mock CM2 (A): trazo .75s, barra 1.5s, velo sale 1.55s.
 */
@Component({
  selector: 'app-logo-reveal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './logo-reveal.html',
  styleUrl: './logo-reveal.scss',
})
export class LogoReveal {
  private reveal = inject(LogoRevealService);
  private motion = inject(MotionService);

  activo = this.reveal.activo;
  reducida = computed(() => this.motion.reducido());
  /** Fase de salida (fundido del velo). */
  saliendo = signal(false);

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private hapticTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAt = -1;

  // Tiempos (ms). Completa: ~1,55s de reveal + 0,35s de salida (mock CM2 Main).
  private readonly EXIT_MS = 350;
  private readonly HOLD_FULL = 1550;
  private readonly HOLD_REDUCED = 900;
  private readonly EXIT_REDUCED = 300;

  constructor() {
    effect(() => {
      const on = this.activo();
      const at = this.reveal.at();
      if (!on || at === this.lastAt) return;
      this.lastAt = at;
      this.arrancar();
    });
  }

  /** Programa la vibración final y el auto-cierre (sin bloquear nada). */
  private arrancar(): void {
    this.clearTimers();
    this.saliendo.set(false);
    const reducida = this.motion.reducido();
    const hold = reducida ? this.HOLD_REDUCED : this.HOLD_FULL;
    const exit = reducida ? this.EXIT_REDUCED : this.EXIT_MS;
    if (!reducida) {
      this.hapticTimer = setTimeout(() => void this.vibrar(), hold - 60);
    }
    this.exitTimer = setTimeout(() => this.saliendo.set(true), hold);
    this.closeTimer = setTimeout(() => this.cerrar(), hold + exit);
  }

  /** Tocar el velo = saltar: salta a la salida de inmediato. */
  skip(): void {
    if (this.saliendo()) return;
    if (this.hapticTimer) clearTimeout(this.hapticTimer);
    if (this.exitTimer) clearTimeout(this.exitTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.saliendo.set(true);
    const exit = this.motion.reducido() ? this.EXIT_REDUCED : this.EXIT_MS;
    this.closeTimer = setTimeout(() => this.cerrar(), exit);
  }

  private cerrar(): void {
    this.clearTimers();
    this.saliendo.set(false);
    this.reveal.cerrar();
  }

  private clearTimers(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.exitTimer) clearTimeout(this.exitTimer);
    if (this.hapticTimer) clearTimeout(this.hapticTimer);
    this.closeTimer = this.exitTimer = this.hapticTimer = null;
  }

  /** Vibración muy corta (solo nativo; plugin opcional). */
  private async vibrar(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      /* sin motor de vibración → no pasa nada */
    }
  }
}
