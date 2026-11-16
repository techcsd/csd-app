import { inject, Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { emailParaMostrar } from '../../../core/util/usuario-email';

/**
 * BH4 — `{{ user.email | emailDisplay }}` → muestra la cédula (o "Usuario de prueba")
 * cuando el correo es sintético del acceso por cédula; el correo real tal cual.
 * Standalone, pura: úsala en cualquier lugar que hoy pinte un correo de usuario.
 */
@Pipe({ name: 'emailDisplay', standalone: true, pure: false })
export class EmailDisplayPipe implements PipeTransform {
  private i18n = inject(I18nService);
  transform(email: string | null | undefined): string | null {
    const r = emailParaMostrar(email);
    if (r === 'Usuario de prueba' || r === 'Acceso por cédula') return this.i18n.t(r);
    if (r && r.startsWith('Cédula ')) return this.i18n.t('Cédula {n}', { n: r.slice(7) });
    return r;
  }
}
