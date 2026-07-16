import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/**
 * Share a plain-text summary (e.g. an inventory movement) to WhatsApp etc.
 * Native → @capacitor/share; PWA → Web Share API; fallback → clipboard.
 * Mirrors the pre-uso share pattern but text-only (no file needed).
 * Returns how the share resolved so the UI can nudge the user if it fell back.
 */
export async function compartirTexto(
  title: string,
  text: string,
): Promise<{ ok: boolean; fallback: boolean }> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text });
      return { ok: true, fallback: false };
    } catch {
      // APP-050: cancelar la hoja de compartir de Android rechaza la promesa;
      // es un no-op benigno, no un error para el usuario.
      return { ok: false, fallback: false };
    }
  }

  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, text });
      return { ok: true, fallback: false };
    } catch {
      // user cancelled or share unavailable → fall through
    }
  }

  // Fallback: copy to clipboard so the user can paste into WhatsApp.
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, fallback: true };
  } catch {
    return { ok: false, fallback: true };
  }
}
