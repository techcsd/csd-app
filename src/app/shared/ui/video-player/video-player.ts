import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { VideoPlayerService, VideoPlayerSource } from './video-player.service';
import { MotionService } from '../../../core/services/motion.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { motionTokens } from '../../motion/motion-tokens';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

const RATES = [1, 1.25, 1.5, 2] as const;

/**
 * CM3 (PROMPT-95 F5) — reproductor de video a pantalla completa ("teatro"), una sola
 * instancia montada en app.html. Lo abre `VideoPlayerService.open(fuente)`.
 *
 * Controles (copia del mock CM3-dudas): reproducir/pausar, sonido, barra de progreso
 * que se puede arrastrar, **subtítulos (CC)** si el video trae .vtt, **velocidad**
 * (1× → 2×), **pantalla completa** (que permite girar a horizontal en Android vía la
 * Fullscreen API — no forzamos orientación) y **capítulos** en una hoja inferior que
 * salta el video a ese segundo.
 *
 * Cierre: ✕, botón físico "Atrás" de Android (NavGuard) y Esc en PWA. El overlay es
 * negro; con reduce-motion la entrada es un fundido simple.
 */
@Component({
  selector: 'app-video-player',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
})
export class VideoPlayer {
  private vp = inject(VideoPlayerService);
  private motion = inject(MotionService);
  private navGuard = inject(NavGuardService);

  vm = this.vp.estado;

  private videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private rootRef = viewChild<ElementRef<HTMLDivElement>>('root');

  // Estado reactivo de la UI.
  playing = signal(false);
  muted = signal(false);
  ccOn = signal(false);
  rateIdx = signal(0);
  current = signal(0);
  total = signal(0);
  controles = signal(true);
  capsAbiertos = signal(false);
  fullscreen = signal(false);

  rate = computed(() => RATES[this.rateIdx()]);
  tieneCC = computed(() => !!this.vm()?.subtitulos);
  capitulos = computed(() => this.vm()?.capitulos ?? []);
  pct = computed(() => {
    const t = this.total();
    return t > 0 ? Math.min(100, (this.current() / t) * 100) : 0;
  });
  tiempo = computed(() => `${this.fmt(this.current())} / ${this.fmt(this.total())}`);
  capActivo = computed(() => {
    const caps = this.capitulos();
    const c = this.current();
    let idx = -1;
    for (let i = 0; i < caps.length; i++) if (caps[i].segundo <= c + 0.3) idx = i;
    return idx;
  });

  private lastAt = -1;
  private ocultarTimer: ReturnType<typeof setTimeout> | null = null;
  private backHandler = (): boolean => {
    this.close();
    return true;
  };

  constructor() {
    effect(() => {
      const st = this.vp.estado();
      if (st && st.at !== this.lastAt) {
        this.lastAt = st.at;
        this.onOpened(st);
      } else if (!st && this.lastAt !== -1) {
        this.lastAt = -1;
        this.navGuard.clearOverlay(this.backHandler);
      }
    });
  }

  private onOpened(st: VideoPlayerSource): void {
    this.resetEstado();
    this.navGuard.registerOverlay(this.backHandler);
    // El <video> se monta con @if este tick; lo preparamos en el siguiente frame.
    requestAnimationFrame(() => {
      const root = this.rootRef()?.nativeElement;
      if (root && !this.motion.reducido()) {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionTokens.base, easing: 'ease' });
      }
      this.aplicarCC(false);
      void this.intentarReproducir();
      this.programarOcultar();
    });
  }

  private resetEstado(): void {
    this.playing.set(false);
    this.muted.set(false);
    this.ccOn.set(false);
    this.rateIdx.set(0);
    this.current.set(0);
    this.total.set(0);
    this.controles.set(true);
    this.capsAbiertos.set(false);
  }

  private get video(): HTMLVideoElement | null {
    return this.videoRef()?.nativeElement ?? null;
  }

  private async intentarReproducir(): Promise<void> {
    const v = this.video;
    if (!v) return;
    try {
      await v.play(); // el toque que abrió el player cuenta como gesto → con sonido
      this.playing.set(true);
    } catch {
      this.playing.set(false); // autoplay bloqueado → queda el botón grande de play
    }
  }

  // ── Eventos del <video> ──────────────────────────────────────────────────────
  onLoaded(): void {
    const v = this.video;
    if (v) this.total.set(v.duration || 0);
  }
  onTime(): void {
    const v = this.video;
    if (v) this.current.set(v.currentTime || 0);
  }
  onPlay(): void {
    this.playing.set(true);
  }
  onPause(): void {
    this.playing.set(false);
  }
  onEnded(): void {
    this.playing.set(false);
    this.controles.set(true);
  }

  // ── Controles ─────────────────────────────────────────────────────────────────
  togglePlay(ev?: Event): void {
    ev?.stopPropagation();
    const v = this.video;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    this.mostrarControles();
  }

  toggleMute(ev: Event): void {
    ev.stopPropagation();
    const v = this.video;
    if (!v) return;
    v.muted = !v.muted;
    this.muted.set(v.muted);
    this.mostrarControles();
  }

  ciclarVelocidad(ev: Event): void {
    ev.stopPropagation();
    const next = (this.rateIdx() + 1) % RATES.length;
    this.rateIdx.set(next);
    const v = this.video;
    if (v) v.playbackRate = RATES[next];
    this.mostrarControles();
  }

  toggleCC(ev: Event): void {
    ev.stopPropagation();
    this.aplicarCC(!this.ccOn());
    this.mostrarControles();
  }

  private aplicarCC(on: boolean): void {
    const v = this.video;
    if (!v?.textTracks?.length) {
      this.ccOn.set(false);
      return;
    }
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = on ? 'showing' : 'hidden';
    }
    this.ccOn.set(on);
  }

  toggleCapitulos(ev: Event): void {
    ev.stopPropagation();
    this.capsAbiertos.update((x) => !x);
    this.mostrarControles();
  }

  irACapitulo(seg: number, ev: Event): void {
    ev.stopPropagation();
    const v = this.video;
    if (!v) return;
    v.currentTime = seg;
    this.current.set(seg);
    void v.play().catch(() => {});
    this.capsAbiertos.set(false);
    this.mostrarControles();
  }

  /** Arrastre/toque en la barra de progreso → salta a esa posición. */
  seek(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const v = this.video;
    if (!v || !this.total()) return;
    const seg = (parseFloat(input.value) / 100) * this.total();
    v.currentTime = seg;
    this.current.set(seg);
    this.mostrarControles();
  }

  async toggleFullscreen(ev: Event): Promise<void> {
    ev.stopPropagation();
    const root = this.rootRef()?.nativeElement;
    if (!root) return;
    try {
      if (!document.fullscreenElement) await root.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      /* algunos WebView no lo permiten → no pasa nada, el overlay ya es full-bleed */
    }
  }

  @HostListener('document:fullscreenchange')
  onFsChange(): void {
    this.fullscreen.set(!!document.fullscreenElement);
  }

  /** Toque sobre el lienzo: muestra/oculta controles (y reproduce si estaba parado). */
  tocarLienzo(): void {
    if (this.capsAbiertos()) {
      this.capsAbiertos.set(false);
      return;
    }
    if (this.controles()) this.controles.set(false);
    else this.mostrarControles();
  }

  private mostrarControles(): void {
    this.controles.set(true);
    this.programarOcultar();
  }

  private programarOcultar(): void {
    if (this.ocultarTimer) clearTimeout(this.ocultarTimer);
    this.ocultarTimer = setTimeout(() => {
      if (this.playing() && !this.capsAbiertos()) this.controles.set(false);
    }, 3200);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.vp.estado()) this.close();
  }

  close(): void {
    if (this.ocultarTimer) clearTimeout(this.ocultarTimer);
    const v = this.video;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load(); // corta el streaming del bucket privado
    }
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    this.vp.close();
  }

  /** m:ss de un número de segundos (barra de tiempo y etiqueta de capítulo). */
  fmt(s: number): string {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
}
