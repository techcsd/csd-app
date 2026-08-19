import { afterNextRender, ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';
import { ErrorReportService } from '../../../core/services/error-report.service';

/**
 * Voice-note recorder — alternative to typing (UI/UX principle #3, incidente
 * flow). Records via MediaRecorder; emits the audio blob (or null when
 * cleared). Falls back gracefully if the mic isn't available.
 */
@Component({
  selector: 'app-voice-recorder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './voice-recorder.html',
  styleUrl: './voice-recorder.scss',
})
export class VoiceRecorder implements OnDestroy {
  private toast = inject(ToastService);
  private permissions = inject(PermissionsService);
  private gate = inject(PermisoGateService);
  private errors = inject(ErrorReportService);

  /**
   * AX2 — modo de UI:
   *  - 'toggle' (default): botón grabar/detener + vista previa + `clear()`. Lo usa
   *    `voice-notes` para acumular N notas en un formulario.
   *  - 'push': barra tipo WhatsApp de un solo estado; AUTO-arranca la grabación al
   *    mostrarse y expone `enviarNota()`/`cancelar()`. Lo usa el chat.
   */
  mode = input<'toggle' | 'push'>('toggle');

  /** Y11 — número de barras del medidor de nivel (tipo WhatsApp). */
  readonly bars = Array.from({ length: 16 }, (_, i) => i);

  recording = signal(false);
  /** 'toggle' — object-URL de la vista previa tras detener (para el <audio>). */
  previewUrl = signal<string | null>(null);
  /** Y11 — nivel por barra (0..1) del micrófono en vivo. */
  niveles = signal<number[]>(new Array(16).fill(0));
  /** Y11 — segundos transcurridos de la grabación. */
  segundos = signal(0);
  /** Y11 — no hay medidor de nivel (Web Audio no disponible) → fallback de pulso. */
  sinNivel = signal(false);
  recorded = output<Blob | null>();

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  /** AX2 — true cuando el usuario canceló: onstop emite null en vez del blob. */
  private cancelado = false;
  // Y11 — Web Audio para el medidor de nivel.
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  /** mm:ss del tiempo transcurrido. */
  tiempo = computed(() => {
    const s = this.segundos();
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, '0')}`;
  });

  constructor() {
    // AX2 — en modo 'push' (chat) arranca la grabación al mostrarse (un solo
    // estado tipo WhatsApp). El tap en el mic del composer es el gesto del
    // usuario y el permiso ya suele estar concedido por el onboarding (AL5/AW13).
    afterNextRender(() => {
      if (this.mode() === 'push') void this.start();
    });
  }

  /** Alterna grabar/detener (modo 'toggle', usado por voice-notes). */
  async toggle(): Promise<void> {
    if (this.recording()) this.recorder?.stop();
    else await this.start();
  }

  /** Arranca la grabación. Si no hay permiso/mic, emite null (el consumidor cierra). */
  async start(): Promise<void> {
    if (this.recording()) return;
    // X4 — asegurar el micrófono con su explicación antes de grabar; si el
    // usuario no lo concede, la tarjeta ya le indicó cómo activarlo.
    if (!(await this.gate.asegurar('mic'))) {
      this.recorded.emit(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.cancelado = false;
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.stopMeter();
        this.recording.set(false);
        if (this.cancelado) {
          this.recorded.emit(null);
          return;
        }
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
        // 'toggle' — deja una vista previa reproducible; 'push' (chat) envía directo.
        if (this.mode() === 'toggle') {
          const old = this.previewUrl();
          if (old) URL.revokeObjectURL(old);
          this.previewUrl.set(URL.createObjectURL(blob));
        }
        this.recorded.emit(blob);
      };
      this.recorder.start();
      this.recording.set(true);
      this.startMeter(stream); // Y11 — medidor de nivel + timer
    } catch (e) {
      this.onMicError(e);
      this.recorded.emit(null);
    }
  }

  /** AX2 — detiene y ENVÍA la nota (onstop emite el blob). Modo 'push'. */
  enviarNota(): void {
    if (this.recording()) this.recorder?.stop();
    else this.recorded.emit(null);
  }

  /** AX2 — CANCELA: detiene y descarta (onstop emite null). */
  cancelar(): void {
    this.cancelado = true;
    if (this.recording()) this.recorder?.stop();
    else this.recorded.emit(null);
  }

  /**
   * Y11 — arranca el medidor: AnalyserNode sobre el stream + timer. Si Web Audio
   * no está disponible, cae al fallback de pulso (sinNivel) con solo el timer.
   */
  private startMeter(stream: MediaStream): void {
    this.startedAt = Date.now();
    this.segundos.set(0);
    this.tick = setInterval(() => {
      this.segundos.set(Math.floor((Date.now() - this.startedAt) / 1000));
    }, 500);

    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.sinNivel.set(true);
      return;
    }
    try {
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64; // → 32 bins; suficiente para un medidor
      source.connect(this.analyser);
      this.sinNivel.set(false);
      const bins = this.analyser.frequencyBinCount;
      const data = new Uint8Array(bins);
      const N = this.bars.length;
      const per = Math.max(1, Math.floor(bins / N));
      const loop = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        const out = new Array<number>(N);
        for (let b = 0; b < N; b++) {
          let sum = 0;
          for (let k = 0; k < per; k++) sum += data[b * per + k] ?? 0;
          // Realza un poco los valores bajos para que la voz normal se vea.
          out[b] = Math.min(1, (sum / per / 255) * 1.6);
        }
        this.niveles.set(out);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    } catch {
      // Web Audio falló (p. ej. WebView restringido) → fallback de pulso.
      this.sinNivel.set(true);
      this.audioCtx = null;
      this.analyser = null;
    }
  }

  /** Y11 — detiene el medidor y libera Web Audio. */
  private stopMeter(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.tick != null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.analyser = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.niveles.set(new Array(this.bars.length).fill(0));
  }

  /** P1 — mensaje claro según la causa; ofrecer ajustes si quedó bloqueado. */
  private onMicError(e: unknown): void {
    const name = (e as DOMException)?.name ?? '';
    // Y6 — telemetría explícita del fallo de grabación de voz (mismo pipeline
    // outbox/sanitizado/anti-loop). `name` clasifica la causa (permiso/mic ausente).
    void this.errors.report('voice', e instanceof Error ? e.message : String(e), {
      name,
      native: this.permissions.isNative,
    });
    if (name === 'NotFoundError') {
      this.toast.error('No hay micrófono disponible en el dispositivo. Puedes escribir la nota.');
      return;
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      if (this.permissions.isNative) {
        this.toast.withAction('El micrófono está bloqueado. Actívalo para grabar la nota.', {
          label: 'Abrir ajustes',
          run: () => void this.permissions.openAppSettings(),
        });
      } else {
        this.toast.error('El micrófono está bloqueado. Actívalo en los ajustes del navegador.');
      }
      return;
    }
    this.toast.error('No pudimos usar el micrófono. Puedes escribir la nota.');
  }

  /** Modo 'toggle' — resetea el grabador para la siguiente nota (emite null). */
  clear(): void {
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.previewUrl.set(null);
    this.recorded.emit(null);
  }

  ngOnDestroy(): void {
    // AX2 — si se destruye mientras graba, corta sin emitir (el consumidor cerró).
    this.cancelado = true;
    if (this.recording()) this.recorder?.stop();
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.stopMeter(); // Y11 — liberar Web Audio + timer
  }
}
