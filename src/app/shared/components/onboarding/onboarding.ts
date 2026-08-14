import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LocalStore } from '../../../core/services/local-store.service';
import { PermissionsService } from '../../../core/services/permissions.service';

interface Step {
  icon?: string;
  title: string;
  text: string;
  /** CSS selector of the real element to spotlight. Omit for a centered card. */
  target?: string;
  /** P2 — paso que pide un permiso del dispositivo (muestra botón "Permitir"). */
  permission?: 'location';
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
    icon: '📍',
    title: 'Permite tu ubicación',
    text: 'La usamos para registrar dónde recibes un vehículo o de dónde sale una ruta. Puedes cambiarlo luego en los ajustes del teléfono.',
    permission: 'location',
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
  private permissions = inject(PermissionsService);

  readonly steps = STEPS;
  visible = signal(false);
  index = signal(0);
  rect = signal<Rect | null>(null);
  pop = signal<{ top: number; left: number } | null>(null);
  pidiendoPermiso = signal(false);

  // AQ4 — referencia al tooltip para medir su altura REAL y recolocarlo (antes se
  // asumía 210px fijos → decidía mal si iba arriba/abajo y se cortaba).
  private popCard = viewChild<ElementRef<HTMLElement>>('popcard');

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
    // AQ4 — trae el elemento al centro del viewport ANTES de resaltarlo. Sin esto,
    // un target fuera de pantalla (barra de sync abajo, tile bajo el pliegue en un
    // teléfono chico) daba un rect fuera del área visible y el recuadro se cortaba.
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      /* navegadores viejos: se mide igual */
    }
    setTimeout(() => this.measure(el), 160);
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

  /** P2 — pide el permiso de ubicación desde el onboarding y avanza. */
  async permitirUbicacion(): Promise<void> {
    if (this.pidiendoPermiso()) return;
    this.pidiendoPermiso.set(true);
    try {
      await this.permissions.requestLocation();
    } finally {
      this.pidiendoPermiso.set(false);
      this.next();
    }
  }

  private measure(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const pad = 6;
    const vh = window.innerHeight;
    const safeTop = this.safeInset('--safe-top');
    const safeBottom = this.safeInset('--safe-bottom');
    // AQ4 — clampa el recuadro dentro del área segura (nunca bajo el notch/barra),
    // por si el elemento quedó parcialmente fuera tras el scroll.
    const top = Math.max(safeTop + 4, r.top - pad);
    const bottom = Math.min(vh - safeBottom - 4, r.bottom + pad);
    const rect: Rect = {
      top,
      left: Math.max(4, r.left - pad),
      width: r.width + pad * 2,
      height: Math.max(24, bottom - top),
    };
    this.rect.set(rect);
    // 1ª pasada con altura estimada; 2ª con la altura REAL ya renderizada.
    this.pop.set(this.placePop(rect, 220));
    requestAnimationFrame(() => {
      const h = this.popCard()?.nativeElement.offsetHeight;
      if (h && this.rect() === rect) this.pop.set(this.placePop(rect, h));
    });
  }

  /** AQ4 — lee un inset de área segura (--safe-top/--safe-bottom) en px. */
  private safeInset(name: string): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private placePop(rect: Rect, popH: number): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = Math.min(340, vw - 24);
    const gap = 14;
    const safeTop = this.safeInset('--safe-top');
    const safeBottom = this.safeInset('--safe-bottom');
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const minTop = safeTop + 8;
    const maxTop = Math.max(minTop, vh - safeBottom - popH - 8);
    // Debajo del target si el tooltip cabe entero; si no, encima. Siempre clampado
    // dentro del área segura para que los botones queden visibles.
    const below = rect.top + rect.height + gap;
    const cabeAbajo = below + popH <= vh - safeBottom - 8;
    const top = clamp(cabeAbajo ? below : rect.top - popH - gap, minTop, maxTop);
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
