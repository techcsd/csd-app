import { UserContextService } from '../services/user-context.service';
import { I18nService } from '../i18n/i18n.service';
import { visibleHomeTiles } from '../../pages/home/home';
import { IndiceBuscadorEntry, tokenizar } from './buscador-coincidencia.util';

/**
 * DG2 — índice ÚNICO del buscador compacto: los mismos tiles gateados que pinta
 * Home (`visibleHomeTiles`), traducidos igual que se ven en pantalla. Nunca una
 * segunda lista (DG-08): si un módulo no aparece en Home, tampoco aparece aquí; si
 * el usuario no tiene permiso, `visibleHomeTiles` ya lo excluyó.
 */
export function construirIndiceBuscador(ctx: UserContextService, i18n: I18nService): IndiceBuscadorEntry[] {
  return visibleHomeTiles(ctx).map((tile) => {
    const titulo = i18n.t(tile.label);
    return {
      id: tile.modulo,
      titulo,
      ruta: tile.route,
      camino: titulo,
      modulo: tile.modulo,
      palabrasClave: tokenizar(titulo),
    };
  });
}
