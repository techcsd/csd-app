import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { VoicePlaybackService } from '../../../core/services/voice-playback.service';

/**
 * AY16 + AW13 + AS11 — reproductor de nota de voz del chat (estilo WhatsApp).
 *
 * Sobre `<audio controls>` (que mostraba 0:00/0:00 hasta cargar y no dejaba
 * cambiar velocidad) este player añade: duración REAL desde metadata al instante
 * (AY16), velocidad 1×/1.5×/2× (AW13) y —AS11— una **barra de progreso
 * arrastrable** (seek con touch/ratón + teclado), **un solo audio a la vez**,
 * **autoplay encadenado** y **marca de reproducido**. Iconos SVG (AW12).
 */
@Component({
  selector: 'app-voice-player',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './voice-player.html',
  styleUrl: './voice-player.scss',
})
export class VoicePlayer implements AfterViewInit, OnDestroy {
  /** Signed URL of the audio file. */
  src = input.required<string>();
  /** Duration in seconds known from the message metadata — shown before load. */
  duracion = input<number | null>(null);
  /** AS11 — id estable del mensaje: coordina one-at-a-time / autoplay / reproducido. */
  msgId = input<string>('');
  /** AS11 — orden en el hilo (para encadenar la siguiente nota al terminar). */
  orden = input<number>(0);
  /** AS11 — true si la nota es MÍA (no se pinta el punto de "no reproducido"). */
  mio = input<boolean>(false);

  private audioRef = viewChild<ElementRef<HTMLAudioElement>>('el');
  private trackRef = viewChild<ElementRef<HTMLDivElement>>('track');

  private playback = inject(VoicePlaybackService);

  playing = signal(false);
  private actual = signal(0); // current playback time (s)
  private cargada = signal(0); // duration once the browser loads metadata (s)
  velocidad = signal(1); // 1 | 1.5 | 2
  private arrastrando = signal(false);

  private readonly speeds = [1, 1.5, 2];
  private pendingSeek: number | null = null; // fracción a aplicar cuando cargue metadata
  private cargado = false;

  /** Total to display: the loaded duration wins, else the metadata hint (AY16). */
  private total = computed(() => this.cargada() || this.duracion() || 0);

  progreso = computed(() => {
    const t = this.total();
    return t > 0 ? Math.min(100, (this.actual() / t) * 100) : 0;
  });

  /** While stopped show the full duration; while playing show elapsed / total. */
  etiquetaTiempo = computed(() =>
    this.playing() || this.actual() > 0
      ? `${this.fmt(this.actual())} / ${this.fmt(this.total())}`
      : this.fmt(this.total()),
  );

  /** AS11 — punto de "no reproducido": solo en notas entrantes aún sin escuchar. */
  noReproducido = computed(() => !this.mio() && !!this.msgId() && !this.playback.played().has(this.msgId()));

  ngAfterViewInit(): void {
    const id = this.msgId();
    if (!id) return;
    this.playback.register(id, {
      order: this.orden(),
      play: () => this.play(),
      pause: () => {
        const el = this.audioRef()?.nativeElement;
        if (el && !el.paused) el.pause();
      },
    });
  }
  ngOnDestroy(): void {
    if (this.msgId()) this.playback.unregister(this.msgId());
  }

  toggle(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    if (el.paused) this.play();
    else el.pause();
  }

  private play(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    this.playback.starting(this.msgId()); // pausa los demás + marca reproducido
    el.playbackRate = this.velocidad();
    void el.play();
  }

  ciclarVelocidad(): void {
    const i = this.speeds.indexOf(this.velocidad());
    const next = this.speeds[(i + 1) % this.speeds.length];
    this.velocidad.set(next);
    const el = this.audioRef()?.nativeElement;
    if (el) el.playbackRate = next;
  }

  // ── AS11 — seek arrastrable (touch + ratón) ────────────────────────────────
  onPointerDown(ev: PointerEvent): void {
    const el = this.trackRef()?.nativeElement;
    if (!el) return;
    this.arrastrando.set(true);
    el.setPointerCapture?.(ev.pointerId);
    this.seekDesdeX(ev.clientX);
  }
  onPointerMove(ev: PointerEvent): void {
    if (!this.arrastrando()) return;
    this.seekDesdeX(ev.clientX);
  }
  onPointerUp(ev: PointerEvent): void {
    if (!this.arrastrando()) return;
    this.arrastrando.set(false);
    this.trackRef()?.nativeElement.releasePointerCapture?.(ev.pointerId);
  }

  /** Teclado (web/accesibilidad): flechas ±5 s, Inicio/Fin. */
  onKey(ev: KeyboardEvent): void {
    const t = this.total();
    if (t <= 0) return;
    let time: number | null = null;
    if (ev.key === 'ArrowRight') time = Math.min(t, this.actual() + 5);
    else if (ev.key === 'ArrowLeft') time = Math.max(0, this.actual() - 5);
    else if (ev.key === 'Home') time = 0;
    else if (ev.key === 'End') time = t;
    if (time === null) return;
    ev.preventDefault();
    this.aplicarSeek(time / t);
  }

  private seekDesdeX(clientX: number): void {
    const el = this.trackRef()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    this.aplicarSeek(frac);
  }

  private aplicarSeek(frac: number): void {
    const el = this.audioRef()?.nativeElement;
    const t = this.total();
    if (!el || t <= 0) return;
    this.actual.set(frac * t); // feedback visual inmediato
    if (this.cargado && Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = frac * el.duration;
    } else {
      // Aún sin metadata (preload='none'): recuérdalo y fuerza la carga una vez.
      this.pendingSeek = frac;
      el.preload = 'metadata';
      el.load();
    }
  }

  onPlay(): void {
    this.playing.set(true);
  }
  onPause(): void {
    this.playing.set(false);
  }
  onEnded(): void {
    this.playing.set(false);
    this.actual.set(0);
    this.playback.ended(this.msgId()); // autoplay de la siguiente
  }
  onTime(): void {
    if (this.arrastrando()) return; // no pisar el arrastre con el timeupdate
    const el = this.audioRef()?.nativeElement;
    if (el) this.actual.set(el.currentTime);
  }
  onMeta(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    this.cargado = true;
    if (Number.isFinite(el.duration)) this.cargada.set(el.duration);
    if (this.pendingSeek !== null && Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = this.pendingSeek * el.duration;
      this.pendingSeek = null;
    }
  }

  private fmt(s: number): string {
    const sec = Math.max(0, Math.floor(s));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }
}
