import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { InAppCameraService } from './in-app-camera.service';

/** W1 — practical cap for a single multi-pick batch (configurable, kept high). */
const GALLERY_LIMIT = 40;

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
  private inApp = inject(InAppCameraService);

  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async takePhoto(): Promise<CapturedPhoto | null> {
    // M1 — blindaje total: una excepción aquí (permiso, plugin, WebView) jamás
    // debe tumbar el wizard de pre-uso. Ante cualquier fallo devolvemos null.
    try {
      // Cámara EMBEBIDA primero: captura dentro de la app (no sale a la cámara del
      // sistema), lo que evita que MIUI/low-mem maten la app durante la foto. Si el
      // dispositivo no soporta getUserMedia, cae a la cámara del sistema.
      if (this.inApp.supported) {
        // En nativo, asegura el permiso de cámara del SO para que getUserMedia del
        // WebView funcione. REQUIERE `android.permission.CAMERA` en el manifest
        // (M1): sin él, el WebView deniega getUserMedia y el overlay cae al
        // fallback de sistema, que es lo que MIUI mataba.
        if (this.isNative) {
          try {
            const p = await Camera.checkPermissions();
            if (p.camera !== 'granted') await Camera.requestPermissions({ permissions: ['camera'] });
          } catch {
            /* seguimos: si falla, el overlay caerá a 'fallback' */
          }
        }
        const res = await this.inApp.open();
        if (res === 'fallback') return this.takeConSistema();
        if (!res) return null;
        // El overlay ya entrega un JPEG comprimido (≤1280, 0.7).
        return { blob: res, previewUrl: URL.createObjectURL(res) };
      }
      return await this.takeConSistema();
    } catch {
      return null;
    }
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
    const blobs = this.isNative ? await this.pickNativeMulti(limit) : await this.pickWebMulti();
    const out: CapturedPhoto[] = [];
    for (const raw of blobs) {
      const blob = this.isNative ? raw : await this.compress(raw);
      out.push({ blob, previewUrl: URL.createObjectURL(blob) });
    }
    return out;
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
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.onchange = () => resolve(input.files?.[0] ?? null);
      // If the user cancels the picker there is no reliable event; the promise
      // simply never resolves for that attempt, which is fine (no photo added).
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
