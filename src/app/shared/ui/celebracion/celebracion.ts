import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { MotionService, Celebracion } from '../../../core/services/motion.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * CJ2/CJ3 — overlay global de celebración ("conduce creado" = papel que vuela a la
 * carpeta; "ruta creada" = camión CSD que cruza la pantalla). Se monta una vez en el
 * shell (app.html) y observa `MotionService.celebracion()`. No bloquea (la acción ya
 * ocurrió), se salta tocando, `aria-live`, vibración corta al aterrizar (solo nativo).
 * Con reduce-motion (SO o ajuste) se degrada a solo el check. Variante corta (0,8s)
 * para el encolado offline. Copia exacta de los mocks CJ2/CJ3 (tiempos en el SCSS).
 */
@Component({
  selector: 'app-celebracion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './celebracion.html',
  styleUrl: './celebracion.scss',
})
export class CelebracionOverlay {
  private motion = inject(MotionService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  cel = this.motion.celebracion;
  reducida = computed(() => this.motion.reducido());

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private hapticTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAt = -1;

  constructor() {
    effect(() => {
      const c = this.cel();
      if (!c || c.at === this.lastAt) return;
      this.lastAt = c.at ?? 0;
      this.arrancar(c);
    });
  }

  /** Programa la vibración (al aterrizar) y el auto-cierre según la variante. */
  private arrancar(c: Celebracion): void {
    this.clearTimers();
    const reducida = this.motion.reducido();
    const corta = !!c.corta || reducida;
    const dur = corta ? 1400 : 3200; // deja leer el mensaje + tocar la acción
    const hapticAt = corta ? 120 : 1500; // en la grande, al caer el check
    this.hapticTimer = setTimeout(() => void this.vibrar(), hapticAt);
    this.closeTimer = setTimeout(() => this.motion.cerrarCelebracion(), dur);
  }

  private clearTimers(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.hapticTimer) clearTimeout(this.hapticTimer);
    this.closeTimer = this.hapticTimer = null;
  }

  /** Tocar el velo = saltar. */
  skip(): void {
    this.clearTimers();
    this.motion.cerrarCelebracion();
  }

  /** Botón de acción ("Ver conduce" / "Ir a mi ruta"). */
  accion(c: Celebracion): void {
    this.clearTimers();
    this.motion.cerrarCelebracion();
    if (c.accionUrl) void this.router.navigateByUrl(c.accionUrl);
  }

  titulo(c: Celebracion): string {
    return this.i18n.t(c.tipo === 'ruta' ? 'Ruta creada' : 'Conduce creado');
  }

  subtitulo(c: Celebracion): string {
    if (c.tipo === 'ruta') {
      const n = c.paradas ?? 0;
      return `${n} ${this.i18n.t('paradas · ubicación activa durante la ruta')}`;
    }
    return [c.numero, c.destino].filter(Boolean).join(' · ');
  }

  /** Vibración corta (solo nativo; plugin opcional). */
  private async vibrar(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      /* plugin ausente / sin motor de vibración → no pasa nada */
    }
  }
}
