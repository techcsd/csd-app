import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';

/**
 * AY16 + AW13 — custom voice-note player for the chat.
 *
 * The native `<audio controls>` showed 0:00/0:00 until the file was loaded and
 * gave no way to change speed. This player shows the REAL duration from the
 * message metadata (`duracion`, seconds) the instant the bubble renders — never
 * 0:00 — and adds a 1×/1.5×/2× speed toggle. Icons are SVG (AW12), no emojis.
 */
@Component({
  selector: 'app-voice-player',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './voice-player.html',
  styleUrl: './voice-player.scss',
})
export class VoicePlayer {
  /** Signed URL of the audio file. */
  src = input.required<string>();
  /** Duration in seconds known from the message metadata — shown before load. */
  duracion = input<number | null>(null);

  private audioRef = viewChild<ElementRef<HTMLAudioElement>>('el');

  playing = signal(false);
  private actual = signal(0); // current playback time (s)
  private cargada = signal(0); // duration once the browser loads metadata (s)
  velocidad = signal(1); // 1 | 1.5 | 2

  private readonly speeds = [1, 1.5, 2];

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

  toggle(): void {
    const el = this.audioRef()?.nativeElement;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = this.velocidad();
      void el.play();
    } else {
      el.pause();
    }
  }

  ciclarVelocidad(): void {
    const i = this.speeds.indexOf(this.velocidad());
    const next = this.speeds[(i + 1) % this.speeds.length];
    this.velocidad.set(next);
    const el = this.audioRef()?.nativeElement;
    if (el) el.playbackRate = next;
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
  }
  onTime(): void {
    const el = this.audioRef()?.nativeElement;
    if (el) this.actual.set(el.currentTime);
  }
  onMeta(): void {
    const el = this.audioRef()?.nativeElement;
    if (el && Number.isFinite(el.duration)) this.cargada.set(el.duration);
  }

  private fmt(s: number): string {
    const sec = Math.max(0, Math.floor(s));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }
}
