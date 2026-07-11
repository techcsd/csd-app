import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { LocalStore } from '../../../core/services/local-store.service';

interface Slide {
  icon: string;
  title: string;
  text: string;
}

// One idea per screen, big icon + plain words. Mirrors the field-first design
// so a first-time user with low digital literacy understands the app in ~20s.
const SLIDES: Slide[] = [
  {
    icon: '👋',
    title: 'Bienvenido a la app de campo',
    text: 'Aquí registras tu trabajo del día: bitácoras, vehículos, materiales y más. Un botón = una tarea.',
  },
  {
    icon: '📶',
    title: 'Funciona sin señal',
    text: 'Todo lo que registres se guarda en el teléfono y se envía solo cuando vuelve el internet. Nunca pierdes tu trabajo.',
  },
  {
    icon: '📸',
    title: 'Toma fotos y firma',
    text: 'Muchas tareas piden una foto o una firma. Es fácil: la cámara y el dedo bastan.',
  },
  {
    icon: '✅',
    title: 'La barra de abajo te avisa',
    text: 'Verde = todo enviado. Amarillo = hay algo esperando señal. Así siempre sabes cómo vas.',
  },
];

const DONE_KEY = 'csd_onboarding_v1_done';

/**
 * First-run tutorial. Shows a few skippable full-screen slides the first time
 * a user reaches Home, then never again (flag stored in LocalStore). Self-gates:
 * Home always renders it; it stays hidden unless the flag is missing.
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

  readonly slides = SLIDES;
  visible = signal(false);
  index = signal(0);

  constructor() {
    void this.store.get(DONE_KEY).then((v) => {
      if (!v) this.visible.set(true);
    });
  }

  isLast(): boolean {
    return this.index() === SLIDES.length - 1;
  }

  next(): void {
    if (this.isLast()) {
      void this.finish();
      return;
    }
    this.index.update((i) => i + 1);
  }

  skip(): void {
    void this.finish();
  }

  private async finish(): Promise<void> {
    this.visible.set(false);
    await this.store.set(DONE_KEY, '1');
  }
}
