import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';

import { PermisoGateService } from './permiso-gate.service';
import { ToastService } from './toast.service';
import { I18nService } from '../i18n/i18n.service';
import { extraerTokenQr } from '../util/doc-qr';

/**
 * DX7/F4 — escáner de QR dentro de la app.
 *  · APK/iOS: plugin `@capacitor-mlkit/barcode-scanning` (Capawesome, Capacitor 8, mantenido):
 *    usa el módulo de escáner de Google (sin pedir el permiso de cámara a la app, sin APK extra).
 *  · PWA / sin Google Play services: `BarcodeDetector` si existe; si no, `jsqr` con carga diferida.
 *    La vista (`app-escaner`) la pinta el host del shell; este servicio solo coordina.
 */
@Injectable({ providedIn: 'root' })
export class EscanerService {
  private gate = inject(PermisoGateService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  /** Visor web abierto (lo lee `app-escaner`). */
  abierto = signal(false);
  private resolverWeb: ((texto: string | null) => void) | null = null;

  /** Lo llama el visor web al leer un código o cerrarse (`null` = cancelado). */
  terminarWeb(texto: string | null): void {
    this.abierto.set(false);
    this.resolverWeb?.(texto);
    this.resolverWeb = null;
  }

  /** Abre el escáner, y si lee un QR de SGC navega a `/d/<token>`. */
  async escanearYAbrir(): Promise<void> {
    const texto = await this.leer();
    if (texto == null) return; // cancelado
    const token = extraerTokenQr(texto);
    if (!token) {
      this.toast.error(this.i18n.t('Este QR no es de CSD. Escanea el QR de un conduce o de una requisición.'));
      return;
    }
    await this.router.navigate(['/d', token]);
  }

  /** Devuelve el texto leído o `null` si el usuario canceló. */
  async leer(): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const r = await this.leerNativo();
      if (r !== 'fallback') return r;
    }
    // Web (o nativo sin servicios de Google): se explica el permiso y se abre el visor.
    if (!(await this.gate.asegurar('camera'))) return null;
    return new Promise<string | null>((resolve) => {
      this.resolverWeb = resolve;
      this.abierto.set(true);
    });
  }

  private async leerNativo(): Promise<string | null | 'fallback'> {
    try {
      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
      const { supported } = await BarcodeScanner.isSupported();
      if (!supported) return 'fallback';
      // Módulo de Google: se instala una vez (necesita red); si no se puede, cae al visor web.
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        try {
          await BarcodeScanner.installGoogleBarcodeScannerModule();
        } catch {
          return 'fallback';
        }
        return 'fallback'; // la instalación es asíncrona: esta vez usa el visor web
      }
      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      return barcodes[0]?.rawValue ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(msg)) return null;
      return 'fallback';
    }
  }
}
