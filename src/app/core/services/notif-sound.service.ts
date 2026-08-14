import { Injectable } from '@angular/core';

/**
 * AQ1 — sonido sutil "tipo WhatsApp" cuando llega un aviso con la app ABIERTA
 * (mensaje, entrega por confirmar, ruta, consumo anormal…). Web Audio, sin asset:
 * dos notas cortas y suaves. Autoplay: el AudioContext puede quedar suspendido
 * hasta el primer gesto del usuario → en ese caso falla en silencio (nunca crashea).
 *
 * El sonido de las notificaciones con la app CERRADA/en background lo maneja el
 * canal de notificaciones nativo de Android (heads-up + sonido). Web Audio no puede
 * leer el estado del timbre del sistema, así que el "modo silencio" del teléfono no
 * silencia este chime in-app; sí lo hace bajando el volumen de multimedia.
 */
@Injectable({ providedIn: 'root' })
export class NotifSoundService {
  private ctx: AudioContext | null = null;
  private ultimo = 0;

  /** Reproduce el chime (anti-ráfaga: máx. una vez cada 1.2 s). */
  chime(): void {
    const now = Date.now();
    if (now - this.ultimo < 1200) return;
    this.ultimo = now;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = this.ctx ?? new Ctor();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      this.nota(ctx, 660, 0, 0.12);
      this.nota(ctx, 880, 0.12, 0.16);
    } catch {
      /* sin Web Audio o bloqueado hasta un gesto del usuario: silencio */
    }
  }

  private nota(ctx: AudioContext, freq: number, offset: number, dur: number): void {
    const t0 = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}
