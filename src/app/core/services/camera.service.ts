import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { PermisoGateService } from './permiso-gate.service';
import { ErrorReportService } from './error-report.service';
import { DeviceInfoService } from './device-info.service';
import { PermissionsService } from './permissions.service';
import { ToastService } from './toast.service';

/** W1 — practical cap for a single multi-pick batch (configurable, kept high). */
const GALLERY_LIMIT = 40;

/**
 * Y5 — versión MAYOR mínima razonable del Android System WebView para que
 * getUserMedia funcione de forma fiable (Chromium 80 ≈ 2020). Por debajo, un
 * fallo de cámara probablemente sea el WebView desactualizado del equipo → se lo
 * decimos al usuario. Es un umbral heurístico, documentado a propósito.
 */
const MIN_WEBVIEW_MAJOR = 80;

export interface CapturedPhoto {
  /** Compressed JPEG blob, ready to upload to Storage. */
  blob: Blob;
  /** Object URL for immediate preview (revoke when done). */
  previewUrl: string;
}

/** A picked document — an image (compressed) or a PDF kept as-is (X1). */
export interface CapturedDoc {
  blob: Blob;
  nombre: string;
  esImagen: boolean;
  /** File extension for the storage path (`jpg` | `pdf`). */
  ext: string;
  /** Object URL for image preview (null for PDF); revoke when done. */
  previewUrl: string | null;
}

/**
 * AQ9 — a picked chat attachment: any file. Images are compressed like a photo;
 * other documents (pdf/doc/xls/…) are kept as-is with their real name + mime.
 */
export interface CapturedFile {
  blob: Blob;
  nombre: string;
  mime: string;
  esImagen: boolean;
  /** Object URL for image preview (null for non-images); revoke when done. */
  previewUrl: string | null;
}

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;
/** Native camera/gallery quality (0-100) — Capacitor resizes + compresses on
 *  device, which is far faster than decoding a full-res photo in JS canvas. */
const NATIVE_QUALITY = 72;

/**
 * Single entry point for taking photos. Uses the native camera on Android
 * (Capacitor) and an <input capture> fallback on the PWA. Always returns a
 * compressed JPEG (~1280px longest edge, ~70%) so field captures stay under
 * the mobile-data budget (PRD: parte diario w/ 6 fotos <= 3MB).
 */
@Injectable({ providedIn: 'root' })
export class CameraService {
  private gate = inject(PermisoGateService);
  private errorReport = inject(ErrorReportService);
  private device = inject(DeviceInfoService);
  private permissions = inject(PermissionsService);
  private toast = inject(ToastService);

  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** AT9 — ¿PWA sobre iOS (Safari/WKWebView)? La cámara aquí es terreno de
   *  `<input capture>`, no de la cámara nativa de Capacitor. */
  get isIOSWeb(): boolean {
    if (this.isNative) return false;
    const ua = navigator.userAgent || '';
    // iPadOS 13+ se presenta como "Macintosh" pero con pantalla táctil.
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  }

  async takePhoto(): Promise<CapturedPhoto | null> {
    // AT9 — PWA/iOS y web en general: NO pasamos por la puerta de permisos.
    // `<input type=file capture>` usa el permiso de cámara DEL SISTEMA (el que
    // pide iOS al abrir su cámara), no el permiso de sitio de Safari — y sondear
    // con getUserMedia (lo que hacía la puerta) es (a) innecesario para el input
    // capture y (b) DESTRUYE el gesto de usuario que iOS exige para que
    // `input.click()` abra la cámara. Esa era la causa de "pide permiso pero
    // nunca abre". Por eso el camino web abre el input DE FORMA SÍNCRONA, sin
    // ningún `await` previo (takeWeb() se invoca síncrono dentro del executor de
    // su Promise). El llamador (photo-slot) tampoco debe `await` nada antes.
    if (!this.isNative) {
      try {
        const raw = await this.takeWeb();
        if (!raw) return null;
        const blob = await this.compress(raw);
        return { blob, previewUrl: URL.createObjectURL(blob) };
      } catch (e) {
        if (!this.isCancel(e)) await this.handleCameraFailure(e, 'takePhoto');
        return null;
      }
    }
    // X4 — nativo (Android): aseguramos el permiso con su explicación; si falta y
    // el usuario no lo concede, degradamos a null (sin crash ni spinner colgado).
    // El plugin nativo gestiona su propio prompt del SO (sin doble prompt, AA16).
    if (!(await this.gate.asegurar('camera'))) return null;
    // AE7 — cámara NATIVA del sistema (Capacitor Camera, `CameraSource.Camera`):
    // es la que espera el usuario y resuelve el caso del OUKITEL de Y5, donde
    // getUserMedia del WebView fallaba. M1 — blindaje total: cualquier fallo real
    // avisa con causa+acción y se reporta (Y5/Y6), devolviendo null. Cancelar no reporta.
    try {
      return await this.takeConSistema();
    } catch (e) {
      if (!this.isCancel(e)) await this.handleCameraFailure(e, 'takePhoto');
      return null;
    }
  }

  /**
   * AT9 — fallback explícito "Subir foto" para iOS/PWA cuando la cámara no abre:
   * abre el selector de archivos SIN `capture`, así el usuario puede elegir una
   * foto de su carrete (o sacarla desde la hoja del sistema). Nunca lo dejamos
   * sin poder completar el checklist. Devuelve la foto comprimida o null.
   */
  async pickSingleFile(): Promise<CapturedPhoto | null> {
    try {
      const raw = await this.pickWebSingle();
      if (!raw) return null;
      const blob = await this.compress(raw);
      return { blob, previewUrl: URL.createObjectURL(blob) };
    } catch (e) {
      if (!this.isCancel(e)) await this.handleCameraFailure(e, 'pickSingleFile');
      return null;
    }
  }

  /** ¿La excepción es una cancelación del usuario (no un error real)? */
  private isCancel(e: unknown): boolean {
    const m = ((e as Error)?.message ?? '').toLowerCase();
    const name = (e as { name?: string })?.name ?? '';
    return name === 'AbortError' || /cancel|dismiss|no image picked|user cancelled/.test(m);
  }

  /**
   * Y5 — clasifica el fallo de cámara, avisa al usuario con la causa y una acción
   * clara (nunca fallo silencioso) y lo reporta a telemetría con el estado del
   * permiso y la versión del WebView (clave para el diagnóstico del OUKITEL).
   */
  private async handleCameraFailure(e: unknown, point: string): Promise<void> {
    const name = (e as { name?: string })?.name ?? '';
    const raw = ((e as Error)?.message ?? String(e)) || '';
    const m = raw.toLowerCase();
    let perm = 'desconocido';
    try {
      perm = await this.permissions.checkCamera();
    } catch {
      /* ignore */
    }
    const wvMajor = this.device.webViewMajor();

    let text: string;
    let withSettings = false;
    if (perm === 'denied' || name === 'NotAllowedError' || /denied|permission|not allowed/.test(m)) {
      text = 'La cámara está bloqueada por permisos.';
      withSettings = true;
    } else if (name === 'NotReadableError' || name === 'TrackStartError' || /in use|could not start|busy/.test(m)) {
      text = 'La cámara está en uso por otra app. Ciérrala e intenta de nuevo.';
    } else if (name === 'NotFoundError' || /not found|no camera|devices? not found/.test(m)) {
      text = 'No se encontró una cámara en el dispositivo.';
    } else if (this.isNative && wvMajor != null && wvMajor < MIN_WEBVIEW_MAJOR) {
      text = `La app "Android System WebView" está desactualizada (v${wvMajor}). Actualízala desde Play Store para usar la cámara.`;
    } else {
      text = 'No se pudo abrir la cámara. Intenta de nuevo.';
    }

    if (withSettings && this.permissions.isNative) {
      this.toast.withAction(text, { label: 'Abrir ajustes', run: () => void this.permissions.openAppSettings() });
    } else {
      this.toast.error(text);
    }

    void this.errorReport.report('camera', `${name || 'Error'}: ${raw}`, {
      point,
      exception: name,
      permiso: perm,
      webview: this.device.info()?.webViewVersion ?? '',
      webview_major: wvMajor ?? 0,
      native: this.isNative,
    });
  }

  /** Cámara del sistema (Capacitor nativo / input web) — fallback. */
  private async takeConSistema(): Promise<CapturedPhoto | null> {
    const raw = this.isNative ? await this.takeNative() : await this.takeWeb();
    if (!raw) return null;
    // Nativo: Capacitor ya redimensionó/comprimió en el dispositivo → no hace
    // falta el canvas JS. Web/PWA: sí comprimimos en JS.
    const blob = this.isNative ? raw : await this.compress(raw);
    return { blob, previewUrl: URL.createObjectURL(blob) };
  }

  /**
   * W1 — pick MANY photos at once from the gallery (native multi-select /
   * PWA multi-file input). Each is compressed like a camera shot. Used by the
   * bitácora photo step so the user can attach 20+ photos in one go.
   */
  async pickFromGallery(limit = GALLERY_LIMIT): Promise<CapturedPhoto[]> {
    try {
      const blobs = this.isNative ? await this.pickNativeMulti(limit) : await this.pickWebMulti();
      const out: CapturedPhoto[] = [];
      for (const raw of blobs) {
        const blob = this.isNative ? raw : await this.compress(raw);
        out.push({ blob, previewUrl: URL.createObjectURL(blob) });
      }
      return out;
    } catch (e) {
      if (!this.isCancel(e)) await this.handleCameraFailure(e, 'pickFromGallery');
      return [];
    }
  }

  /**
   * X1 — pick a single document from the device: image OR PDF. Images are
   * compressed like a photo; PDFs are kept as-is. Uses a plain file input so it
   * works on both the PWA and the Android WebView (Camera.pickImages can't take
   * PDFs). Returns null if the user cancels.
   */
  pickDocument(): Promise<CapturedDoc | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          resolve({ blob: file, nombre: file.name, esImagen: false, ext: 'pdf', previewUrl: null });
          return;
        }
        const blob = await this.compress(file);
        resolve({
          blob,
          nombre: file.name || 'documento.jpg',
          esImagen: true,
          ext: 'jpg',
          previewUrl: URL.createObjectURL(blob),
        });
      };
      input.click();
    });
  }

  /**
   * AQ9 — pick ANY file for a chat attachment. Images are compressed (~1280px,
   * q0.7 JPEG) like a photo; other documents (pdf/doc/xls/ppt/txt/csv…) are kept
   * as-is with their real filename + mime. Works on the PWA and the Android
   * WebView (plain file input). Returns null if the user cancels.
   */
  pickAttachment(): Promise<CapturedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept =
        'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        if (file.type.startsWith('image/')) {
          const blob = await this.compress(file);
          resolve({
            blob,
            nombre: file.name || 'foto.jpg',
            mime: 'image/jpeg',
            esImagen: true,
            previewUrl: URL.createObjectURL(blob),
          });
          return;
        }
        resolve({
          blob: file,
          nombre: file.name || 'archivo',
          mime: file.type || 'application/octet-stream',
          esImagen: false,
          previewUrl: null,
        });
      };
      input.click();
    });
  }

  /** Take a document photo with the camera (wraps takePhoto → CapturedDoc). */
  async takeDocumentPhoto(): Promise<CapturedDoc | null> {
    const photo = await this.takePhoto();
    if (!photo) return null;
    return { blob: photo.blob, nombre: 'foto.jpg', esImagen: true, ext: 'jpg', previewUrl: photo.previewUrl };
  }

  private async pickNativeMulti(limit: number): Promise<Blob[]> {
    // width → Capacitor baja la resolución en el dispositivo (rápido).
    const res = await Camera.pickImages({ quality: NATIVE_QUALITY, limit, width: MAX_EDGE });
    const blobs: Blob[] = [];
    for (const p of res.photos) {
      if (!p.webPath) continue;
      try {
        blobs.push(await (await fetch(p.webPath)).blob());
      } catch {
        /* skip a photo we can't read rather than fail the whole batch */
      }
    }
    return blobs;
  }

  private pickWebMulti(): Promise<Blob[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
      input.click();
    });
  }

  private async takeNative(): Promise<Blob | null> {
    const photo = await Camera.getPhoto({
      quality: NATIVE_QUALITY,
      // width → Capacitor redimensiona en el dispositivo (mucho más rápido que
      // decodificar la foto a resolución completa en JS). Mantiene el aspecto.
      width: MAX_EDGE,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      correctOrientation: true,
    });
    if (!photo.webPath) return null;
    const res = await fetch(photo.webPath);
    return res.blob();
  }

  private takeWeb(): Promise<Blob | null> {
    return this.openFileInput(true);
  }

  /** AT9 — selector de archivo SIN `capture` (fallback "Subir foto" en iOS). */
  private pickWebSingle(): Promise<Blob | null> {
    return this.openFileInput(false);
  }

  /**
   * AT9 — abre un `<input type=file>` de una sola imagen de forma robusta en iOS:
   *  - `capture='environment'` cuando `withCapture` (abre la cámara del sistema);
   *  - se ADJUNTA al DOM (algunos WebView de iOS ignoran el click de un input
   *    huérfano) y se limpia al terminar;
   *  - detecta la cancelación (evento `cancel` + reenfoque de la ventana) para
   *    que el slot no quede colgado en "⏳" si el usuario cierra la cámara sin
   *    tomar la foto (antes la promesa nunca resolvía → botón trabado).
   * IMPORTANTE: el executor de `new Promise` corre síncrono, así que `click()`
   * se dispara dentro del gesto de usuario (requisito de iOS). No añadir `await`
   * antes de llamar a este método.
   */
  private openFileInput(withCapture: boolean): Promise<Blob | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (withCapture) input.setAttribute('capture', 'environment');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.opacity = '0';

      let settled = false;
      const done = (b: Blob | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(b);
      };
      const onFocus = () => {
        // Al volver el foco a la ventana (la cámara/selector se cerró), damos un
        // margen a `change` para ganar; si no llegó archivo, fue cancelación.
        setTimeout(() => {
          if (!input.files || input.files.length === 0) done(null);
        }, 1200);
      };

      input.onchange = () => done(input.files?.[0] ?? null);
      // `cancel` es moderno (Chromium/Safari recientes); el reenfoque cubre el resto.
      input.addEventListener('cancel', () => done(null));
      window.addEventListener('focus', onFocus);

      document.body.appendChild(input);
      input.click();
    });
  }

  /** Downscale + re-encode to JPEG via canvas. */
  private async compress(source: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return new Promise((resolve) => {
      canvas.toBlob(
        (b) => resolve(b ?? source),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  }
}
