import { Directive, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { ScreenSecurityService } from '../../../core/services/screen-security.service';

/**
 * CZ7/DZ-19 — pegado en cada pantalla del Vault (lista/entrada/generador):
 *  - activa FLAG_SECURE nativo (Android) mientras la pantalla está montada,
 *    lo apaga al salir (nunca afecta al resto de la app).
 *  - emite `appVaultBackground` cuando la app pasa a segundo plano (nativo:
 *    evento `pause`; web/PWA: `visibilitychange`→hidden, el best-effort de
 *    DZ-19 para iOS/PWA que no tiene FLAG_SECURE) — el host debe limpiar
 *    cualquier secreto revelado en memoria y cerrar la sesión del Vault.
 * Uso: `<div class="screen" appVaultSecure (appVaultBackground)="alFondo()">`.
 */
@Directive({
  selector: '[appVaultSecure]',
  standalone: true,
})
export class VaultSecureDirective implements OnInit, OnDestroy {
  private screenSecurity = inject(ScreenSecurityService);

  @Output() appVaultBackground = new EventEmitter<void>();

  private pauseHandle: PluginListenerHandle | null = null;

  ngOnInit(): void {
    void this.screenSecurity.enable();
    void CapApp.addListener('pause', this.onBackground).then((h) => (this.pauseHandle = h));
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    void this.screenSecurity.disable();
    void this.pauseHandle?.remove();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onBackground = (): void => {
    this.appVaultBackground.emit();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.appVaultBackground.emit();
  };
}
