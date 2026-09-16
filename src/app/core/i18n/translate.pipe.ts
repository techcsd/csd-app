import { inject, Pipe, PipeTransform } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * BR7 — pipe `t` para traducir en plantillas: `{{ 'Escribe tu cédula.' | t }}`. La
 * clave ES el texto en español (funciona sin catálogo). `pure: false` para que el
 * cambio de idioma (signal) re-renderice inmediatamente sin recargar la app.
 * Los textos son cortos y la búsqueda es un lookup de objeto, así que el costo por
 * ciclo es mínimo.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);
  transform(esText: string, params?: Record<string, string | number>): string {
    return this.i18n.t(esText, params);
  }
}
