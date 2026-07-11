import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { LocalStore } from '../../../core/services/local-store.service';

interface Step {
  icon?: string;
  title: string;
  text: string;
  /** CSS selector of the real element to spotlight. Omit for a centered card. */
  target?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// The tour spotlights the real Home elements as it explains them — show, not
// just tell. One idea per step, big and plain for low-literacy field users.
const STEPS: Step[] = [
  {
    icon: '👋',
    title: 'Bienvenido',
    text: 'Te muestro lo básico en unos segundos. Puedes saltarlo cuando quieras.',
  },
  {
    title: 'Cada botón es una tarea',
    text: 'Toca uno para empezar: registrar una bitácora, recibir un vehículo, pedir materiales…',
    target: '[data-tour="tiles"]',
  },
  {
    title: 'Esta barra te avisa',
    text: 'Verde = todo enviado. Amarillo = hay algo esperando señal. Puedes trabajar sin internet: se envía solo cuando vuelve.',
    target: '[data-tour="sync"]',
  },
  {
    title: 'Tu perfil y ayuda',
    text: 'Aquí arriba está tu perfil, soporte y cómo reportar un problema.',
    target: '[data-tour="perfil"]',
  },
  {
    icon: '✅',
    title: '¡Listo!',
    text: 'Eso es todo. Puedes volver a ver esta guía desde “Soporte y ayuda”.',
  },
];

const DONE_KEY = 'csd_onboarding_v1_done';

/**
 * First-run guided tour. Dims Home and spotlights each real element (tiles,
 * sync bar, profile) while explaining it. Shows once (flag in LocalStore).
 * Self-gates: Home always renders it; it stays hidden unless the flag is missing.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class Onboarding {
  private store = inject(LocalStore);

  readonly steps = STEPS;
  visible = signal(false);
  index = signal(0);
  rect = signal<Rect | null>(null);
  pop = signal<{ top: number; left: number } | null>(null);

  constructor() {
    void this.store.get(DONE_KEY).then((v) => {
      if (!v) this.start();
    });
  }

  start(): void {
    this.visible.set(true);
    setTimeout(() => this.goTo(0), 80);
  }

  current(): Step {
    return this.steps[this.index()];
  }
  isLast(): boolean {
    return this.index() === this.steps.length - 1;
  }

  goTo(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.index.set(i);
    const step = this.steps[i];
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (!el) {
      this.rect.set(null);
      this.pop.set(null);
      return;
    }
    setTimeout(() => this.measure(el), 60);
  }

  next(): void {
    if (this.isLast()) {
      void this.finish();
      return;
    }
    this.goTo(this.index() + 1);
  }
  prev(): void {
    this.goTo(Math.max(0, this.index() - 1));
  }
  skip(): void {
    void this.finish();
  }

  private measure(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const pad = 6;
    const rect: Rect = {
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    this.rect.set(rect);
    this.pop.set(this.placePop(rect));
  }

  private placePop(rect: Rect): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = Math.min(340, vw - 24);
    const th = 210;
    const gap = 14;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    // Below the target if it fits, else above. Horizontally clamped on-screen.
    const top =
      rect.top + rect.height + gap + th < vh
        ? rect.top + rect.height + gap
        : Math.max(12, rect.top - th - gap);
    const left = clamp(rect.left, 12, vw - tw - 12);
    return { top, left };
  }

  private async finish(): Promise<void> {
    this.visible.set(false);
    this.rect.set(null);
    await this.store.set(DONE_KEY, '1');
  }

  spotStyle(): Record<string, string> {
    const r = this.rect();
    if (!r) return {};
    return {
      top: r.top + 'px',
      left: r.left + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    };
  }
  popStyle(): Record<string, string> {
    const p = this.pop();
    if (!p) return {};
    return { top: p.top + 'px', left: p.left + 'px' };
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.visible()) return;
    const step = this.current();
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (el) this.measure(el);
  }
}
