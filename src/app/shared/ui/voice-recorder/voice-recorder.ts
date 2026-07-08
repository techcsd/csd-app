import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';

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
export class VoiceRecorder {
  private toast = inject(ToastService);

  recording = signal(false);
  previewUrl = signal<string | null>(null);
  recorded = output<Blob | null>();

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async toggle(): Promise<void> {
    if (this.recording()) {
      this.recorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
        const old = this.previewUrl();
        if (old) URL.revokeObjectURL(old);
        this.previewUrl.set(URL.createObjectURL(blob));
        this.recording.set(false);
        this.recorded.emit(blob);
      };
      this.recorder.start();
      this.recording.set(true);
    } catch {
      this.toast.error('No pudimos usar el micrófono. Puedes escribir la nota.');
    }
  }

  clear(): void {
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.previewUrl.set(null);
    this.recorded.emit(null);
  }
}
