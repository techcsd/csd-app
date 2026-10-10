import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Momento, MomentoTipo, MotionService } from '../../../core/services/motion.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** CL2 — texto por defecto de cada momento (si no se pasa `texto`). */
const DEFAULT_TEXTO: Record<MomentoTipo, string> = {
  entrada: 'Entrada registrada',
  salida: 'Salida registrada',
  aprobado: 'Aprobado',
  firma: 'Firma registrada',
  combustible: 'Combustible registrado',
  checklist: 'Completado',
  mantenimiento: 'Mantenimiento cerrado',
  mensaje: 'Enviado',
  documento: 'Documento generado',
  uso: 'Listo',
  'todo-enviado': 'Todo enviado',
};

/**
 * CL2 — overlay global de MOMENTO mediano (0,8 s, SIN velo, NO bloquea). Se monta una
 * vez en el shell (app.html) y observa `MotionService.momentoActivo()`. Cada tipo pinta
 * su micro-animación (caja que entra/sale, sello, trazo de firma, gota, cascada de
 * tachados, llave, avión, hoja, llave que pasa de mano, check). Solo `transform`/
 * `opacity`; `aria-live` para lectores; vibración corta solo en nativo. Con reduce-motion
 * (SO o ajuste) se degrada a solo el check + el texto, sin movimiento. Degrada offline
 * igual (es un aviso local). Keyframes/tiempos copiados del mock CL2.
 *
 * `pointer-events:none` en el SCSS → nunca intercepta el siguiente toque (CL2 §4).
 */
@Component({
  selector: 'app-momento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './momento.html',
  styleUrl: './momento.scss',
})
export class MomentoOverlay {
  private motion = inject(MotionService);
  private i18n = inject(I18nService);

  mom = this.motion.momentoActivo;
  reducida = computed(() => this.motion.reducido());

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAt = -1;

  constructor() {
    effect(() => {
      const m = this.mom();
      if (!m || m.at === this.lastAt) return;
      this.lastAt = m.at ?? 0;
      this.arrancar(m);
    });
  }

  /** Programa la vibración corta y el auto-cierre (~1,4 s: 0,8 s de anim + lectura). */
  private arrancar(m: Momento): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    void this.vibrar();
    this.closeTimer = setTimeout(() => this.motion.cerrarMomento(), 1400);
  }

  texto(m: Momento): string {
    return this.i18n.t(m.texto || DEFAULT_TEXTO[m.tipo]);
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
