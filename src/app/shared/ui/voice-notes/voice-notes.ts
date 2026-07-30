import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, model, viewChild } from '@angular/core';
import { VoiceRecorder } from '../voice-recorder/voice-recorder';

/** Z23 — una nota de voz capturada (blob + object-URL para reproducir). */
export interface VoiceNoteItem {
  blob: Blob;
  url: string;
}

/**
 * Z23 — notas de voz MÚLTIPLES por formulario. Envuelve el `VoiceRecorder`
 * (grabación con animación de barras Y11) y acumula N grabaciones con
 * reproducir/eliminar, hasta un límite (default 5, `max_audio_notas`). El padre
 * recibe la lista por `[(notes)]` y sube los blobs por el outbox como las fotos.
 */
@Component({
  selector: 'app-voice-notes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VoiceRecorder],
  templateUrl: './voice-notes.html',
  styleUrl: './voice-notes.scss',
})
export class VoiceNotes implements OnDestroy {
  /** Límite de notas (server: flota_config.max_audio_notas; default 5). */
  max = input(5);
  /** Two-way: la lista de notas grabadas (el padre lee los blobs al enviar). */
  notes = model<VoiceNoteItem[]>([]);
  /**
   * AA12 — cuando el componente vive dentro de un `@if` de paso de wizard, el
   * padre CONSERVA `notes` (blob + url) entre pasos. Con esto NO revocamos las
   * URLs al destruir el componente (si lo hacíamos, al volver al paso la nota
   * salía gris `0:00/0:00` porque el object-URL ya estaba revocado — mismo bug
   * que P10 en photo-slot). El padre es el dueño del ciclo de vida. Default
   * false = comportamiento anterior (pantallas de un solo uso).
   */
  persistUrls = input(false);

  private rec = viewChild(VoiceRecorder);

  puedeGrabar = computed(() => this.notes().length < this.max());

  /** El hijo emite el blob al parar; lo agregamos y reseteamos para la siguiente. */
  add(blob: Blob | null): void {
    if (!blob) return; // clear() del hijo emite null → ignorar
    if (this.notes().length >= this.max()) return;
    const url = URL.createObjectURL(blob);
    this.notes.update((list) => [...list, { blob, url }]);
    // Reinicia el grabador para que quede listo para otra nota.
    this.rec()?.clear();
  }

  remove(i: number): void {
    const it = this.notes()[i];
    if (it) URL.revokeObjectURL(it.url);
    this.notes.update((list) => list.filter((_, idx) => idx !== i));
  }

  ngOnDestroy(): void {
    // AA12 — si el padre conserva las notas entre pasos, NO revocar (sería
    // romper las URLs que el padre sigue mostrando). El padre libera al enviar/salir.
    if (this.persistUrls()) return;
    for (const n of this.notes()) URL.revokeObjectURL(n.url);
  }
}
