import { Injectable, signal } from '@angular/core';

/** Un player registrado: su orden en el hilo + cómo reproducirlo/pausarlo. */
interface Registrado {
  order: number;
  play: () => void;
  pause: () => void;
}

/**
 * AS11 — coordinador de reproducción de notas de voz (estilo WhatsApp).
 *
 * Los `<app-voice-player>` del hilo se registran aquí para lograr tres cosas que
 * un `<audio>` aislado no puede: (1) **un solo audio a la vez** — al arrancar uno
 * se pausan los demás; (2) **autoplay encadenado** — al terminar una nota se
 * reproduce automáticamente la siguiente por orden; (3) **marca de reproducido**
 * — se recuerda (en memoria, por sesión) qué notas ya escuchó el usuario para
 * pintar el punto de "no reproducido" solo en las entrantes pendientes.
 */
@Injectable({ providedIn: 'root' })
export class VoicePlaybackService {
  private players = new Map<string, Registrado>();
  private _played = signal<ReadonlySet<string>>(new Set());
  /** Ids de notas ya reproducidas en esta sesión (para el punto de no-leído). */
  played = this._played.asReadonly();

  /** AS11 — encadenar la siguiente nota al terminar una (confirmado por Xaviel). */
  autoplay = true;

  register(id: string, reg: Registrado): void {
    this.players.set(id, reg);
  }
  unregister(id: string): void {
    this.players.delete(id);
  }

  /** Antes de arrancar un player: pausa todos los demás y márcalo reproducido. */
  starting(id: string): void {
    for (const [pid, p] of this.players) if (pid !== id) p.pause();
    this.markPlayed(id);
  }

  /** Al terminar una nota: si hay autoplay, reproduce la siguiente por orden. */
  ended(id: string): void {
    const cur = this.players.get(id);
    if (!this.autoplay || !cur) return;
    let next: { id: string; order: number } | null = null;
    for (const [pid, p] of this.players) {
      if (p.order > cur.order && (!next || p.order < next.order)) next = { id: pid, order: p.order };
    }
    if (next) this.players.get(next.id)?.play();
  }

  markPlayed(id: string): void {
    if (this._played().has(id)) return;
    const s = new Set(this._played());
    s.add(id);
    this._played.set(s);
  }
  isPlayed(id: string): boolean {
    return this._played().has(id);
  }
}
