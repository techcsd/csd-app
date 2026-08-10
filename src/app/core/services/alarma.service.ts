import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

/** AK10 — datos de la alarma dominical del reporte semanal. */
export interface AlarmaData {
  vehiculoId: string | null;
  ruta: string;
}

/**
 * AK10 — alarma tipo despertador del reporte semanal. Al recibir la push de
 * `alarma-reporte-semanal` (en primer plano) o al abrir la app un DOMINGO sin el
 * reporte hecho, muestra una alerta a pantalla completa con sonido + vibración.
 * Se apaga al ir a hacer el reporte o al posponer 1h.
 *
 * ⚠️ Límite nativo: un full-screen intent con la app CERRADA/en background requiere
 * un plugin/canal de alarma nativo (no instalado). Aquí la alarma es in-app
 * (foreground/al abrir); la push de alta prioridad es la señal. En PWA iOS solo
 * queda el banner + push (Safari no permite sonido/full-screen en background).
 */
@Injectable({ providedIn: 'root' })
export class AlarmaService {
  private router = inject(Router);

  private _activa = signal<AlarmaData | null>(null);
  activa = this._activa.asReadonly();

  private audioCtx: AudioContext | null = null;
  private beepTimer: ReturnType<typeof setInterval> | null = null;
  private pospuestaHasta = 0; // epoch ms hasta el que no re-disparamos

  /** Dispara la alarma (sonido + vibración + overlay). Idempotente si ya activa. */
  disparar(data: AlarmaData): void {
    if (this._activa()) return;
    if (Date.now() < this.pospuestaHasta) return; // pospuesta: no molestar aún
    this._activa.set(data);
    this.iniciarSonido();
    this.vibrar();
  }

  /** Apaga la alarma (para el sonido/vibración y cierra el overlay). */
  apagar(): void {
    this._activa.set(null);
    this.detenerSonido();
  }

  /** "Hacer reporte ahora": apaga y navega al reporte semanal. */
  hacerReporte(): void {
    const ruta = this._activa()?.ruta || '/transporte/reporte-semanal';
    this.apagar();
    void this.router.navigateByUrl(ruta).catch(() => {});
  }

  /** Posponer 1h: apaga y evita re-disparo durante una hora. */
  posponer(): void {
    this.pospuestaHasta = Date.now() + 60 * 60 * 1000;
    this.apagar();
  }

  // ── Sonido tipo despertador (Web Audio; no requiere asset) ──────────────────
  private iniciarSonido(): void {
    try {
      this.audioCtx = this.audioCtx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const beep = () => this.beep();
      beep();
      this.beepTimer = setInterval(beep, 1400);
    } catch {
      /* sin Web Audio (o bloqueado hasta interacción): la alarma visual sigue */
    }
  }
  private beep(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }
  private detenerSonido(): void {
    if (this.beepTimer) {
      clearInterval(this.beepTimer);
      this.beepTimer = null;
    }
  }
  private vibrar(): void {
    try {
      // Patrón tipo despertador (Android WebView; iOS lo ignora).
      navigator.vibrate?.([500, 300, 500, 300, 500]);
    } catch {
      /* no soportado */
    }
  }
}
