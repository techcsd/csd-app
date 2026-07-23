import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { AutosaveService } from '../../../core/services/autosave.service';

/**
 * A guided photo slot. Shows the example/silhouette of the required shot;
 * once captured it shows the thumbnail + ✓. Emits the compressed photo so
 * the wizard can enforce "all required shots taken" before letting the user
 * confirm (VEH-01).
 *
 * P10 — rehidratación. Los wizards renderizan pasos con `@if (step()===N)`, lo
 * que DESTRUYE y RECREA el slot al ir/volver → la miniatura se perdía. Con el
 * input `[foto]` el padre (dueño del estado) le devuelve la foto ya capturada y
 * el slot la vuelve a mostrar. Regla de object-URLs: si el padre pasa `[foto]`,
 * él es el DUEÑO del blob/URL y lo libera al enviar/limpiar; el slot NO revoca
 * en destroy (si no, mataría la URL que el padre sigue usando).
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
  /** P10 — foto ya capturada en el estado del padre, para rehidratar la miniatura. */
  foto = input<CapturedPhoto | null>(null);
  /** W6 — ofrecer también "Galería" además de la cámara (activo por defecto). */
  gallery = input<boolean>(true);

  captured = output<CapturedPhoto>();
  cleared = output<void>();

  private camera = inject(CameraService);
  private autosave = inject(AutosaveService);
  preview = signal<string | null>(null);
  busy = signal(false);

  /** URL a mostrar: la recién capturada localmente o la rehidratada del padre. */
  displayUrl = computed(() => this.preview() ?? this.foto()?.previewUrl ?? null);

  /** W6 — tomar con la cámara. */
  capture(): Promise<void> {
    return this.run(() => this.camera.takePhoto());
  }

  /**
   * W6 — elegir UNA foto de la galería. El picker nativo/archivo saca la app a
   * primer plano y en MIUI puede recrear la Activity: hacemos FLUSH del autosave
   * ANTES de abrirlo (fix U9) para no perder lo capturado si el proceso muere.
   */
  pickFromGallery(): Promise<void> {
    return this.run(async () => {
      await this.autosave.flushAll();
      const [photo] = await this.camera.pickFromGallery(1);
      return photo ?? null;
    });
  }

  private async run(source: () => Promise<CapturedPhoto | null>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const photo = await source();
      if (photo) {
        // Solo revocar la anterior si era local (uso legacy sin [foto]).
        if (!this.foto()) {
          const old = this.preview();
          if (old) URL.revokeObjectURL(old);
        }
        this.preview.set(photo.previewUrl);
        this.captured.emit(photo);
      }
    } finally {
      this.busy.set(false);
    }
  }

  clear(): void {
    // Si el padre es dueño de la foto ([foto]), él libera la URL al recibir
    // `cleared`; aquí no revocamos para no cortarla antes de tiempo.
    if (!this.foto()) {
      const old = this.preview();
      if (old) URL.revokeObjectURL(old);
    }
    this.preview.set(null);
    this.cleared.emit();
  }

  ngOnDestroy(): void {
    // APP-063 — liberar la última object-URL SOLO en uso legacy (sin [foto]).
    // Con [foto], el padre conserva y libera la URL; revocarla aquí rompería la
    // rehidratación al volver al paso (P10).
    if (this.foto()) return;
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
  }
}
