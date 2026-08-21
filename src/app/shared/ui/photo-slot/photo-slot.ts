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
import { UserContextService } from '../../../core/services/user-context.service';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';

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
  imports: [BottomSheet],
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
  /** W6 — ofrecer también "Galería" además de la cámara (activo por defecto).
   *  En los flujos solo-cámara el padre pasa `[gallery]="false"`; ver `showGallery`. */
  gallery = input<boolean>(true);

  captured = output<CapturedPhoto>();
  cleared = output<void>();

  private camera = inject(CameraService);
  private autosave = inject(AutosaveService);
  private ctx = inject(UserContextService);
  preview = signal<string | null>(null);
  busy = signal(false);
  /** AT9 — hoja de ayuda "la cámara no abre" (iOS/PWA). */
  ayudaAbierta = signal(false);

  /** URL a mostrar: la recién capturada localmente o la rehidratada del padre. */
  displayUrl = computed(() => this.preview() ?? this.foto()?.previewUrl ?? null);

  /** AT9 — en web (PWA) ofrecemos el enlace de ayuda/fallback; en iOS lo destacamos. */
  esWeb = !this.camera.isNative;
  esIOS = this.camera.isIOSWeb;

  /**
   * AE6 — regla general del modo solo-cámara: la galería se ofrece cuando el
   * flujo la permite (`gallery()`) O cuando el usuario es admin (Xaviel), que
   * mantiene la galería en TODOS los flujos solo-cámara para QA/pruebas. Nadie
   * más ve la galería en un flujo que la desactivó.
   */
  showGallery = computed(() => this.gallery() || this.ctx.esAdmin());

  /** W6 — tomar con la cámara (nativa del sistema en Android, `<input capture>` en web). */
  capture(): Promise<void> {
    // AT9 — en web/iOS el `<input capture>` DEBE abrirse dentro del gesto de
    // usuario: NO se puede `await` nada antes (ni el flush), o iOS ignora el
    // click y "pide permiso pero nunca abre". Disparamos el flush en paralelo
    // (best-effort) y abrimos la cámara de forma síncrona.
    if (this.esWeb) {
      void this.autosave.flushAll();
      return this.run(() => this.camera.takePhoto());
    }
    // AE7 — nativo (Android): la cámara del sistema saca la app a primer plano y
    // el SO puede matar el proceso (MIUI/OUKITEL/low-mem); hacemos FLUSH del
    // autosave ANTES de abrirla para no perder lo capturado.
    return this.run(async () => {
      await this.autosave.flushAll();
      return this.camera.takePhoto();
    });
  }

  /**
   * AT9 — fallback "Subir foto" desde la hoja de ayuda: cuando la cámara no abre
   * en iOS, el usuario elige una foto de su carrete/archivos y completa igual.
   */
  subirFoto(): Promise<void> {
    this.ayudaAbierta.set(false);
    void this.autosave.flushAll();
    return this.run(() => this.camera.pickSingleFile());
  }

  abrirAyuda(): void {
    this.ayudaAbierta.set(true);
  }

  cerrarAyuda(): void {
    this.ayudaAbierta.set(false);
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
