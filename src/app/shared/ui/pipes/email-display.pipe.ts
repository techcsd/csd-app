import { Pipe, PipeTransform } from '@angular/core';
import { emailParaMostrar } from '../../../core/util/usuario-email';

/**
 * BH4 — `{{ user.email | emailDisplay }}` → muestra la cédula (o "Usuario de prueba")
 * cuando el correo es sintético del acceso por cédula; el correo real tal cual.
 * Standalone, pura: úsala en cualquier lugar que hoy pinte un correo de usuario.
 */
@Pipe({ name: 'emailDisplay', standalone: true })
export class EmailDisplayPipe implements PipeTransform {
  transform(email: string | null | undefined): string | null {
    return emailParaMostrar(email);
  }
}
