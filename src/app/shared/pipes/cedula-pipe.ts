import { Pipe, PipeTransform } from '@angular/core';
import { formatCedula } from '../../core/util/cedula';

/**
 * AV9 — muestra una cédula con el formato `XXX-XXXXXXX-X` (guiones solo
 * visuales). El valor almacenado sigue siendo solo dígitos. Si el texto no
 * parece una cédula RD (≠ 11 dígitos), lo devuelve tal cual para no romper
 * pasaportes/carnets u otros documentos.
 */
@Pipe({ name: 'cedula', standalone: true })
export class CedulaPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (value == null) return '';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length !== 11) return String(value);
    return formatCedula(digits);
  }
}
