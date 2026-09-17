import { Injectable, signal } from '@angular/core';
import { humanizeError } from '../../shared/util/friendly-error.util';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
  action?: ToastAction;
}

/**
 * Human-language messages, never error codes (UI/UX principle #8).
 * Rendered by the root ToastHost.
 *
 * BS2 — red de seguridad central: los toasts de tono `error` pasan por
 * `humanizeError`, así ningún mensaje técnico crudo (PostgREST/Postgres: "permission
 * denied", "violates…", SQLSTATE, "failed to fetch"…) llega a un trabajador de campo,
 * aunque una pantalla pase `e.message` sin traducir. Un mensaje ya amable en español
 * (el 99 % de los toasts, escritos a mano) no matchea las señales técnicas y pasa
 * intacto. `info`/`success` NO se tocan (son textos intencionales del flujo).
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  toasts = this._toasts.asReadonly();
  private seq = 0;

  /** BS2 — humaniza solo el tono `error` (donde suele colarse el crudo). */
  private safe(text: string, tone: Toast['tone']): string {
    return tone === 'error' ? humanizeError(text).mensaje : text;
  }

  show(text: string, tone: Toast['tone'] = 'info', ms = 3500): void {
    const id = ++this.seq;
    this._toasts.update((t) => [...t, { id, text: this.safe(text, tone), tone }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error', 5000);
  }

  /**
   * Toast con acción (p. ej. "Abrir ajustes" cuando falta un permiso).
   * Dura más y la acción cierra el toast al ejecutarse.
   */
  withAction(text: string, action: ToastAction, tone: Toast['tone'] = 'error', ms = 8000): void {
    const id = ++this.seq;
    this._toasts.update((t) => [...t, { id, text: this.safe(text, tone), tone, action }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number): void {
    this._toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
