import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { VaultSessionService } from '../../../../core/services/vault-session.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import {
  etiquetaFortaleza,
  generarLlaveApi,
  generarPassphrase,
  generarPassword,
  generarSemilla2fa,
  SecretoGenerado,
} from '../../../../core/utils/boveda-generador.util';
import { VaultSecureDirective } from '../../../../shared/ui/vault-secure/vault-secure.directive';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';

type Modo = 'password' | 'passphrase' | 'api' | '2fa';

/**
 * CZ9/DZ-13 — generador de claves, también en la app. 100% cliente
 * (crypto.getRandomValues, sin dependencias nuevas): copiar o mostrar, no crea
 * entradas (eso es solo web). No requiere sesión del Vault (es puro utilitario,
 * no toca ningún secreto guardado) pero igual hereda `appVaultSecure` para
 * que la pantalla protegida cubra el valor recién generado.
 */
@Component({
  selector: 'app-vault-generador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, VaultSecureDirective, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './vault-generador.html',
  styleUrl: './vault-generador.scss',
})
export class VaultGeneradorPage {
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  vaultSession = inject(VaultSessionService);

  etiquetaFortaleza = etiquetaFortaleza;

  modo = signal<Modo>('password');
  largo = signal(20);
  resultado = signal<SecretoGenerado | null>(null);

  constructor() {
    this.regenerar();
  }

  setModo(m: Modo): void {
    this.modo.set(m);
    this.regenerar();
  }

  regenerar(): void {
    const m = this.modo();
    if (m === 'password') this.resultado.set(generarPassword({ largo: this.largo() }));
    else if (m === 'passphrase') this.resultado.set(generarPassphrase());
    else if (m === 'api') this.resultado.set(generarLlaveApi('hex'));
    else this.resultado.set(generarSemilla2fa());
  }

  /** La app no crea entradas: "usar esta" = copiarla para pegarla donde haga falta. */
  async copiar(): Promise<void> {
    const r = this.resultado();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.valor);
      this.toast.success(this.i18n.t('Copiado — se borra del portapapeles en 30 s'));
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => undefined);
      }, 30_000);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar.'));
    }
  }

  alFondo(): void {
    // Nada secreto guardado aquí (es un valor generado, no uno del Vault);
    // igual lo limpiamos de la vista al pasar a segundo plano, por si acaso.
    this.resultado.set(null);
  }

  back(): void {
    void this.router.navigate(['/admin/vault']);
  }
}
