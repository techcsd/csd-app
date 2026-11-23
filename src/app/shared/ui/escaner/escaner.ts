import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';

import { EscanerService } from '../../../core/services/escaner.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

interface DetectorQr {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/**
 * DX7/F4 — visor de escaneo para PWA/web (el APK usa el escáner nativo). `BarcodeDetector` si
 * existe; si no, `jsqr` cargado solo cuando se abre. La cámara se apaga siempre al cerrar.
 */
@Component({
  selector: 'app-escaner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './escaner.html',
  styleUrl: './escaner.scss',
})
export class Escaner implements OnDestroy {
  protected svc = inject(EscanerService);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  error = signal('');
  private stream: MediaStream | null = null;
  private timer = 0;
  private activo = false;

  constructor() {
    effect(() => {
      if (this.svc.abierto()) void this.iniciar();
      else this.detener();
    });
  }

  ngOnDestroy(): void {
    this.detener();
  }

  cerrar(): void {
    this.svc.terminarWeb(null);
  }

  private async iniciar(): Promise<void> {
    this.error.set('');
    this.activo = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch {
      this.error.set('No pudimos abrir la cámara. Revisa el permiso de cámara de la app.');
      return;
    }
    // Espera a que el <video> exista (el efecto corre antes del render).
    for (let i = 0; i < 20 && !this.video(); i++) await new Promise((r) => setTimeout(r, 25));
    const el = this.video()?.nativeElement;
    if (!el || !this.activo) {
      this.detener();
      return;
    }
    el.srcObject = this.stream;
    el.setAttribute('playsinline', 'true');
    await el.play().catch(() => {});

    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorQr }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
    const jsQR = detector ? null : (await import('jsqr')).default;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (!this.activo) return;
      try {
        if (el.readyState >= 2) {
          let texto: string | null = null;
          if (detector) {
            texto = (await detector.detect(el))[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            canvas.width = el.videoWidth;
            canvas.height = el.videoHeight;
            ctx.drawImage(el, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            texto = jsQR(img.data, img.width, img.height)?.data ?? null;
          }
          if (texto) {
            this.svc.terminarWeb(texto);
            return;
          }
        }
      } catch {
        // un fotograma fallido no cierra el visor
      }
      this.timer = window.setTimeout(() => void tick(), 200);
    };
    void tick();
  }

  private detener(): void {
    this.activo = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
