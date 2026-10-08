import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';

/**
 * Abre una URL en el navegador del sistema (no un PDF, no dentro del WebView de la
 * app). En nativo usa AppLauncher; en PWA abre una pestaña nueva. Patrón extraído de
 * perfil.ts (abrirWeb) para reutilizarlo en los enlaces legales (CI3) y de tienda.
 */
export async function abrirUrlExterna(url: string): Promise<void> {
  if (!url) return;
  try {
    if (Capacitor.isNativePlatform()) {
      await AppLauncher.openUrl({ url });
      return;
    }
  } catch {
    /* cae al window.open */
  }
  try {
    window.open(url, '_system') ?? window.open(url, '_blank');
  } catch {
    window.location.href = url;
  }
}
