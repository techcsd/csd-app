import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { InAppCameraService } from '../../../core/services/in-app-camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { ErrorReportService } from '../../../core/services/error-report.service';
import { DeviceInfoService } from '../../../core/services/device-info.service';
import { PermissionsService } from '../../../core/services/permissions.service';

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

/**
 * Overlay de cámara embebida (getUserMedia). Se renderiza una vez en la raíz de
 * la app; se muestra cuando InAppCameraService.active(). Captura un frame del
 * <video> a canvas (≤1280px, JPEG 0.7) sin salir de la app. Si getUserMedia
 * falla, ofrece usar la cámara del sistema ('fallback').
 */
@Component({
  selector: 'app-in-app-camera',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './in-app-camera.html',
  styleUrl: './in-app-camera.scss',
})
export class InAppCamera {
  cam = inject(InAppCameraService);
  private toast = inject(ToastService);
  private errorReport = inject(ErrorReportService);
  private device = inject(DeviceInfoService);
  private permissions = inject(PermissionsService);
  private videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  busy = signal(false);
  error = signal(false);
  private stream: MediaStream | null = null;

  constructor() {
    effect(() => {
      if (this.cam.active()) void this.start();
      else this.stop();
    });
  }

  private async start(): Promise<void> {
    this.error.set(false);
    this.busy.set(false);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      // El <video> se renderiza con @if; espera un tick a que exista.
      await new Promise((r) => setTimeout(r, 0));
      const v = this.videoRef()?.nativeElement;
      if (v) {
        v.srcObject = this.stream;
        v.setAttribute('playsinline', 'true');
        await v.play().catch(() => {});
      }
    } catch (e) {
      // Y5/Y6 — este es el punto EXACTO donde el WebView del equipo (caso OUKITEL)
      // deniega getUserMedia. Antes se tragaba la excepción; ahora la capturamos
      // con su nombre/estado de permiso/versión de WebView para el panel de
      // Tecnología. El overlay muestra igual el botón "usar cámara del sistema".
      this.error.set(true);
      void this.reportCameraError(e);
    }
  }

  /** Y6 — reporta el fallo de getUserMedia con contexto de diagnóstico. */
  private async reportCameraError(e: unknown): Promise<void> {
    const name = (e as { name?: string })?.name ?? '';
    const msg = (e as Error)?.message ?? String(e);
    let perm = 'desconocido';
    try {
      perm = await this.permissions.checkCamera();
    } catch {
      /* ignore */
    }
    void this.errorReport.report('camera', `getUserMedia ${name || 'falló'}: ${msg}`, {
      point: 'in-app-overlay',
      exception: name,
      permiso: perm,
      webview: this.device.info()?.webViewVersion ?? '',
      webview_major: this.device.webViewMajor() ?? 0,
    });
  }

  private stop(): void {
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* liberar la cámara nunca debe lanzar */
    }
    this.stream = null;
    const v = this.videoRef()?.nativeElement;
    if (v) v.srcObject = null;
  }

  async capturar(): Promise<void> {
    const v = this.videoRef()?.nativeElement;
    if (!v || this.busy()) return;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;
    this.busy.set(true);
    // M1 — todo el pipeline de captura es a prueba de excepciones/OOM: si algo
    // falla NO cerramos el overlay ni tumbamos la vista; avisamos y el usuario
    // reintenta. Liberamos el canvas siempre (móviles low-mem MIUI).
    let canvas: HTMLCanvasElement | null = null;
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.toast.error('No se pudo procesar la foto. Intenta de nuevo.');
        return;
      }
      ctx.drawImage(v, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => {
        try {
          canvas!.toBlob((b) => res(b), 'image/jpeg', JPEG_QUALITY);
        } catch {
          res(null);
        }
      });
      if (!blob) {
        // Compresión fallida (raro): no cerramos, dejamos reintentar.
        this.toast.error('No se pudo guardar la foto. Intenta de nuevo.');
        return;
      }
      this.cam.finish(blob);
    } catch {
      this.toast.error('No se pudo tomar la foto. Intenta de nuevo.');
    } finally {
      // Liberar el canvas explícitamente para no acumular memoria entre disparos.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      this.busy.set(false);
    }
  }

  cancelar(): void {
    this.cam.finish(null);
  }

  usarSistema(): void {
    this.cam.finish('fallback');
  }
}
