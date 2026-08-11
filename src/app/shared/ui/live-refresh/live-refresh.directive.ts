import { Directive, ElementRef, EventEmitter, OnDestroy, Output, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * AM2 — Refresco homologado para listados de datos vivos. Aplica el patrón que
 * antes vivía inline solo en "Pendiente entrega" (AL13):
 *  - **pull-to-refresh**: arrastrar hacia abajo estando arriba del scroll.
 *  - **refresco al volver a primer plano**: App.resume (nativo) + visibilitychange
 *    (PWA) → refetch silencioso (no parpadea el skeleton).
 * El botón visible "Actualizar" queda en el header de cada pantalla (llama a la
 * misma acción). Emite `appLiveRefresh` con `silent=true` en refrescos automáticos
 * (foreground/pull) para que el host use su bandera `refrescando` en vez de
 * `loading`. Uso:
 *   <div class="screen__body" appLiveRefresh (appLiveRefresh)="refrescar($event)"> … </div>
 */
@Directive({
  selector: '[appLiveRefresh]',
  standalone: true,
})
export class LiveRefreshDirective implements OnDestroy {
  private hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Emite en cada refresco solicitado. `true` = automático (foreground/pull). */
  @Output() appLiveRefresh = new EventEmitter<boolean>();

  private host = this.hostRef.nativeElement;
  private hint: HTMLDivElement;
  private pullStartY = 0;
  private pullActive = false;
  private pullY = 0;

  private resumeHandle: PluginListenerHandle | null = null;

  constructor() {
    // Indicador de pull (gestionado por la directiva; no altera el layout del host).
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.hint = document.createElement('div');
    this.hint.className = 'live-refresh-hint';
    this.hint.setAttribute('aria-hidden', 'true');
    this.host.prepend(this.hint);
    this.setHint(0);

    this.host.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.host.addEventListener('touchmove', this.onTouchMove, { passive: true });
    this.host.addEventListener('touchend', this.onTouchEnd, { passive: true });

    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('resume', () => this.appLiveRefresh.emit(true)).then((h) => (this.resumeHandle = h));
    }
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy(): void {
    this.host.removeEventListener('touchstart', this.onTouchStart);
    this.host.removeEventListener('touchmove', this.onTouchMove);
    this.host.removeEventListener('touchend', this.onTouchEnd);
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.resumeHandle?.remove();
    this.hint.remove();
  }

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') this.appLiveRefresh.emit(true);
  };

  private readonly onTouchStart = (ev: TouchEvent): void => {
    this.pullActive = this.host.scrollTop <= 0;
    this.pullStartY = ev.touches[0]?.clientY ?? 0;
  };
  private readonly onTouchMove = (ev: TouchEvent): void => {
    if (!this.pullActive) return;
    const dy = (ev.touches[0]?.clientY ?? 0) - this.pullStartY;
    if (dy > 0) this.setHint(Math.min(dy * 0.5, 80));
  };
  private readonly onTouchEnd = (): void => {
    if (this.pullY > 60) this.appLiveRefresh.emit(true);
    this.setHint(0);
    this.pullActive = false;
  };

  private setHint(y: number): void {
    this.pullY = y;
    this.hint.style.height = `${y}px`;
    this.hint.textContent = y > 60 ? 'Suelta para actualizar' : y > 0 ? 'Desliza para actualizar' : '';
  }
}
