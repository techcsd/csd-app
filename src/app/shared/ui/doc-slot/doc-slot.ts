import { ChangeDetectionStrategy, Component, OnDestroy, inject, input, output, signal } from '@angular/core';
import { CameraService, CapturedDoc } from '../../../core/services/camera.service';
import { Img } from '../img/img';

/**
 * A document slot for X1 (conductor cédula/licencia, vehicle seguro/matrícula…).
 * Captures a photo OR picks a file/PDF, or — in read-only mode — just shows a
 * link to view the already-uploaded document. Emits the captured doc so the
 * host can enqueue the upload (compressed image / PDF as-is) via DocumentosService.
 */
@Component({
  selector: 'app-doc-slot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Img],
  templateUrl: './doc-slot.html',
  styleUrl: './doc-slot.scss',
})
export class DocSlot implements OnDestroy {
  /** Label of the document, e.g. "Cédula" or "Seguro". */
  label = input.required<string>();
  /** Emphasises the slot + shows a "Falta" badge when empty. */
  requerido = input(false);
  /** View-only (vehicle docs uploaded from the web). Hides capture buttons. */
  soloLectura = input(false);
  /** Signed URL of the already-uploaded document (server), if any. */
  urlExistente = input<string | null>(null);
  /** Whether the existing doc is a PDF (📄) vs an image. */
  esPdfExistente = input(false);
  /** A local upload is queued but not yet synced. */
  enCola = input(false);

  captured = output<CapturedDoc>();
  cleared = output<void>();

  private camera = inject(CameraService);
  local = signal<CapturedDoc | null>(null);
  busy = signal(false);

  async tomarFoto(): Promise<void> {
    await this.pick(() => this.camera.takeDocumentPhoto());
  }

  async elegirArchivo(): Promise<void> {
    await this.pick(() => this.camera.pickDocument());
  }

  private async pick(fn: () => Promise<CapturedDoc | null>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const doc = await fn();
      if (doc) {
        this.revoke();
        this.local.set(doc);
        this.captured.emit(doc);
      }
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    this.revoke();
    this.local.set(null);
    this.cleared.emit();
  }

  private revoke(): void {
    const old = this.local()?.previewUrl;
    if (old) URL.revokeObjectURL(old);
  }

  ngOnDestroy(): void {
    this.revoke();
  }
}
