import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { PhotoViewerService, PhotoViewerState } from './photo-viewer.service';
import { MotionService } from '../../../core/services/motion.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { motionTokens } from '../../motion/motion-tokens';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * CM5 — visor de foto de perfil a pantalla completa (overlay negro, una sola instancia
 * montada en app.html). Lo abre `PhotoViewerService.open(url, origen)` desde cualquier
 * pantalla donde haya una foto REAL (los avatares de iniciales no llaman aquí).
 *
 * Gestos (todo con `transform`/`opacity` sobre la imagen → GPU, sin layout):
 *  · pellizcar para acercar (2 dedos), doble toque para alternar zoom,
 *  · arrastrar para mover cuando está acercada,
 *  · deslizar hacia abajo para cerrar (cuando no está acercada),
 *  · botón ✕ (con aria-label) y el botón físico "Atrás" de Android (vía NavGuard),
 *  · Esc en PWA/escritorio.
 *
 * Apertura: crece desde el avatar tocado (~260 ms); con reduce-motion (SO o ajuste
 * "Animaciones: reducidas") se degrada a un fundido simple. Copia del mock CM5.
 */
@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './photo-viewer.html',
  styleUrl: './photo-viewer.scss',
})
export class PhotoViewer {
  private pv = inject(PhotoViewerService);
  private motion = inject(MotionService);
  private navGuard = inject(NavGuardService);

  vm = this.pv.estado;
  hint = computed(() => !this.motion.reducido());

  private imgRef = viewChild<ElementRef<HTMLImageElement>>('img');
  private backdropRef = viewChild<ElementRef<HTMLDivElement>>('backdrop');

  // ── Estado de transform (se escribe directo al DOM, no signals: rendimiento) ──
  private scale = 1;
  private tx = 0;
  private ty = 0;

  // Punteros activos (pinch/pan). pointerId → posición.
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private panLastX = 0;
  private panLastY = 0;

  // Swipe-para-cerrar (solo cuando no está acercada).
  private swiping = false;
  private swipeStartY = 0;
  private swipeDy = 0;

  // Detección de toque / doble toque.
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private downOnImg = false;
  private lastTapTime = 0;

  private lastAt = -1;
  private backHandler = (): boolean => {
    this.close();
    return true;
  };

  constructor() {
    effect(() => {
      const st = this.pv.estado();
      if (st && st.at !== this.lastAt) {
        this.lastAt = st.at;
        this.onOpened(st);
      } else if (!st && this.lastAt !== -1) {
        this.lastAt = -1;
        this.navGuard.clearOverlay(this.backHandler);
      }
    });
  }

  private onOpened(st: PhotoViewerState): void {
    this.resetGesture();
    this.navGuard.registerOverlay(this.backHandler); // Android "Atrás" cierra el visor
    // La imagen se monta con @if en este tick; animamos en el siguiente frame.
    requestAnimationFrame(() => this.runOpenAnim(st.rect));
  }

  private resetGesture(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.swiping = false;
    this.swipeDy = 0;
    this.pointers.clear();
  }

  /** Animación de apertura: crece desde el avatar tocado; reduce-motion → fundido. */
  private runOpenAnim(rect: DOMRect | null): void {
    const img = this.imgRef()?.nativeElement;
    const backdrop = this.backdropRef()?.nativeElement;
    if (!img || !backdrop) return;
    const reducido = this.motion.reducido();
    // El velo siempre entra con fundido (opacity).
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionTokens.base, easing: 'ease' });
    if (reducido) return; // reduce-motion → solo el fundido del velo

    if (rect) {
      const t = img.getBoundingClientRect();
      if (t.width && t.height) {
        const s = clamp(rect.width / t.width, 0.05, 1);
        const dx = rect.left + rect.width / 2 - (t.left + t.width / 2);
        const dy = rect.top + rect.height / 2 - (t.top + t.height / 2);
        img.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 },
            { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
          ],
          { duration: 260, easing: motionTokens.easeOut },
        );
        return;
      }
    }
    // Sin rect (o sin medida) → fundido con una micro-escala centrada.
    img.animate(
      [
        { transform: 'scale(0.92)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: motionTokens.base, easing: motionTokens.easeOut },
    );
  }

  private apply(): void {
    const img = this.imgRef()?.nativeElement;
    if (img) img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  /** Anima a un estado de transform concreto (doble toque / rebote / ajuste a 1). */
  private animateTo(scale: number, tx: number, ty: number): void {
    const img = this.imgRef()?.nativeElement;
    if (!img) return;
    const from = img.style.transform || 'translate(0px, 0px) scale(1)';
    this.scale = scale;
    this.tx = tx;
    this.ty = ty;
    const to = `translate(${tx}px, ${ty}px) scale(${scale})`;
    if (this.motion.reducido()) {
      img.style.transform = to;
      return;
    }
    const a = img.animate([{ transform: from }, { transform: to }], {
      duration: motionTokens.fast,
      easing: motionTokens.easeOut,
    });
    a.onfinish = () => (img.style.transform = to);
  }

  private clampPan(): void {
    const img = this.imgRef()?.nativeElement;
    if (!img) return;
    const w = img.clientWidth * this.scale;
    const h = img.clientHeight * this.scale;
    const maxX = Math.max(0, (w - window.innerWidth) / 2);
    const maxY = Math.max(0, (h - window.innerHeight) / 2);
    this.tx = clamp(this.tx, -maxX, maxX);
    this.ty = clamp(this.ty, -maxY, maxY);
  }

  // ── Punteros ────────────────────────────────────────────────────────────────
  onDown(ev: PointerEvent): void {
    const target = ev.target as HTMLElement;
    if (target.closest('.pv__close')) return; // el ✕ maneja su propio click
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.pinchStartScale = this.scale;
      this.panLastX = (a.x + b.x) / 2;
      this.panLastY = (a.y + b.y) / 2;
      this.swiping = false;
    } else if (this.pointers.size === 1) {
      this.panLastX = ev.clientX;
      this.panLastY = ev.clientY;
      this.swipeStartY = ev.clientY;
      this.swipeDy = 0;
      this.swiping = this.scale <= 1.01;
      this.downX = ev.clientX;
      this.downY = ev.clientY;
      this.downTime = Date.now();
      this.downOnImg = !!target.closest('.pv__img');
    }
  }

  onMove(ev: PointerEvent): void {
    if (!this.pointers.has(ev.pointerId)) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.scale = clamp((this.pinchStartScale * dist) / this.pinchStartDist, 1, 5);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.tx += mx - this.panLastX;
      this.ty += my - this.panLastY;
      this.panLastX = mx;
      this.panLastY = my;
      this.clampPan();
      this.apply();
      return;
    }

    if (this.scale > 1.01) {
      // Arrastre (foto acercada).
      this.tx += ev.clientX - this.panLastX;
      this.ty += ev.clientY - this.panLastY;
      this.panLastX = ev.clientX;
      this.panLastY = ev.clientY;
      this.clampPan();
      this.apply();
    } else if (this.swiping) {
      // Deslizar hacia abajo para cerrar.
      const dy = ev.clientY - this.swipeStartY;
      this.swipeDy = Math.max(0, dy);
      const k = Math.min(1, this.swipeDy / 400);
      const img = this.imgRef()?.nativeElement;
      const backdrop = this.backdropRef()?.nativeElement;
      if (img) img.style.transform = `translate(0px, ${this.swipeDy}px) scale(${1 - k * 0.15})`;
      if (backdrop) backdrop.style.opacity = String(1 - k * 0.7);
    }
  }

  onUp(ev: PointerEvent): void {
    const had = this.pointers.delete(ev.pointerId);
    if (!had) return;

    // Rebote/ajuste al pasar de 2→1 dedo: re-ancla el pan al dedo que queda.
    if (this.pointers.size === 1) {
      const p = [...this.pointers.values()][0];
      this.panLastX = p.x;
      this.panLastY = p.y;
      this.swiping = this.scale <= 1.01;
      return;
    }
    if (this.pointers.size >= 2) return;

    // Ya no quedan dedos.
    const moved = Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY);
    const wasTap = moved < 12 && Date.now() - this.downTime < 260 && this.swipeDy < 12;

    if (this.swipeDy > 110) {
      this.closeWithExit();
      return;
    }
    if (this.swipeDy > 0) {
      // No llegó al umbral → vuelve a su sitio.
      this.animateTo(1, 0, 0);
      const backdrop = this.backdropRef()?.nativeElement;
      backdrop?.animate([{ opacity: backdrop.style.opacity || '1' }, { opacity: '1' }], {
        duration: motionTokens.fast,
        easing: motionTokens.easeOut,
      });
      if (backdrop) backdrop.style.opacity = '1';
      this.swipeDy = 0;
      return;
    }

    if (wasTap) {
      const now = Date.now();
      if (this.downOnImg) {
        if (now - this.lastTapTime < 300) {
          this.lastTapTime = 0;
          this.toggleZoom();
        } else {
          this.lastTapTime = now;
        }
      } else {
        // Toque simple fuera de la imagen (velo) → cerrar.
        this.closeWithExit();
      }
    }

    // Si el pinch terminó por debajo de 1, asegúrate de volver a 1 centrado.
    if (this.scale <= 1.01 && (this.tx !== 0 || this.ty !== 0 || this.scale !== 1)) {
      this.animateTo(1, 0, 0);
    }
  }

  onCancel(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size === 0 && this.swipeDy > 0) {
      this.animateTo(1, 0, 0);
      const backdrop = this.backdropRef()?.nativeElement;
      if (backdrop) backdrop.style.opacity = '1';
      this.swipeDy = 0;
    }
  }

  /** Doble toque: alterna entre 1× y 2.5× (al centro). */
  private toggleZoom(): void {
    if (this.scale > 1.01) this.animateTo(1, 0, 0);
    else this.animateTo(2.5, 0, 0);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.pv.estado()) this.closeWithExit();
  }

  /** Cierre con fundido/caída (toques del usuario). El back físico cierra directo. */
  private closeWithExit(): void {
    const img = this.imgRef()?.nativeElement;
    const backdrop = this.backdropRef()?.nativeElement;
    if (this.motion.reducido() || !img || !backdrop) {
      this.close();
      return;
    }
    const dy = this.swipeDy > 0 ? Math.max(this.swipeDy, 160) : 120;
    img.animate(
      [
        { transform: img.style.transform || 'none', opacity: 1 },
        { transform: `translate(0px, ${dy}px) scale(0.9)`, opacity: 0 },
      ],
      { duration: motionTokens.fast, easing: motionTokens.easeIn },
    );
    const a = backdrop.animate([{ opacity: backdrop.style.opacity || '1' }, { opacity: 0 }], {
      duration: motionTokens.fast,
      easing: motionTokens.easeIn,
    });
    a.onfinish = () => this.close();
  }

  close(): void {
    this.pv.close();
  }
}
