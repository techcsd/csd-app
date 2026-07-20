import { Injectable, signal } from '@angular/core';

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
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  toasts = this._toasts.asReadonly();
  private seq = 0;

  show(text: string, tone: Toast['tone'] = 'info', ms = 3500): void {
    const id = ++this.seq;
    this._toasts.update((t) => [...t, { id, text, tone }]);
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
    this._toasts.update((t) => [...t, { id, text, tone, action }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number): void {
    this._toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
