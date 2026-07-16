import { ChangeDetectionStrategy, Component, OnDestroy, inject, input, output, signal } from '@angular/core';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';

/**
 * A guided photo slot. Shows the example/silhouette of the required shot;
 * once captured it shows the thumbnail + ✓. Emits the compressed photo so
 * the wizard can enforce "all required shots taken" before letting the user
 * confirm (VEH-01).
 */
@Component({
  selector: 'app-photo-slot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-slot.html',
  styleUrl: './photo-slot.scss',
})
export class PhotoSlot implements OnDestroy {
  /** Short label of the shot, e.g. "Frente" or "Tablero (km visible)". */
  label = input.required<string>();
  /** Example glyph shown before capture. */
  hint = input<string>('📷');

  captured = output<CapturedPhoto>();
  cleared = output<void>();

  private camera = inject(CameraService);
  preview = signal<string | null>(null);
  busy = signal(false);

  async capture(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) {
        const old = this.preview();
        if (old) URL.revokeObjectURL(old);
        this.preview.set(photo.previewUrl);
        this.captured.emit(photo);
      }
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.preview.set(null);
    this.cleared.emit();
  }

  ngOnDestroy(): void {
    // APP-063 — liberar la última object-URL si el wizard se destruye con foto.
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
  }
}
