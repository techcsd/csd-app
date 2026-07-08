import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export interface CapturedPhoto {
  /** Compressed JPEG blob, ready to upload to Storage. */
  blob: Blob;
  /** Object URL for immediate preview (revoke when done). */
  previewUrl: string;
}

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

/**
 * Single entry point for taking photos. Uses the native camera on Android
 * (Capacitor) and an <input capture> fallback on the PWA. Always returns a
 * compressed JPEG (~1280px longest edge, ~70%) so field captures stay under
 * the mobile-data budget (PRD: parte diario w/ 6 fotos <= 3MB).
 */
@Injectable({ providedIn: 'root' })
export class CameraService {
  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async takePhoto(): Promise<CapturedPhoto | null> {
    const raw = this.isNative ? await this.takeNative() : await this.takeWeb();
    if (!raw) return null;
    const blob = await this.compress(raw);
    return { blob, previewUrl: URL.createObjectURL(blob) };
  }

  private async takeNative(): Promise<Blob | null> {
    const photo = await Camera.getPhoto({
      quality: 80,
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
