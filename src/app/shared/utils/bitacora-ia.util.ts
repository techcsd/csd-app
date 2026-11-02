/**
 * DF1-A (PROMPT 129) — helpers puros del "Modo rápido" de bitácora. Mismo
 * contrato que su espejo en el repo SGC (src/shared/utils/bitacora-ia.util.ts):
 * un campo se pinta verde (alta) si confianza ≥ UMBRAL, ámbar (dudosa) si tiene
 * valor pero confianza baja, gris (vacía) si no hay valor.
 */

export type FuenteCampo = 'voz' | 'foto' | 'ambas';

export interface CampoPropuesto<T = unknown> {
  valor: T | null;
  confianza: number;
  fuente?: FuenteCampo;
}

export type ClasificacionConfianza = 'alta' | 'dudosa' | 'vacia';

export const UMBRAL_CONFIANZA_BAJA = 0.7;

/** ¿El campo tiene valor y su confianza alcanza el umbral para mostrarse "resuelto" (verde)? */
export function clasificarConfianza(valor: unknown, confianza: number): ClasificacionConfianza {
  if (valor === null || valor === undefined || valor === '') return 'vacia';
  return confianza >= UMBRAL_CONFIANZA_BAJA ? 'alta' : 'dudosa';
}

/** Cuenta cuántos campos (de un mapa de CampoPropuesto) quedaron "dudosos" (ámbar). */
export function contarDudosos(campos: Record<string, CampoPropuesto>): number {
  return Object.values(campos).filter((c) => clasificarConfianza(c.valor, c.confianza) === 'dudosa').length;
}

/** Quita acentos/diacríticos y pasa a minúsculas — para comparar texto "tal cual suena". */
export function normalizarTexto(s: string): string {
  return Array.from(s.normalize('NFD'))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return !(c >= 0x0300 && c <= 0x036f);
    })
    .join('')
    .trim()
    .toLowerCase();
}

/** Empareja `valor` contra el catálogo real por coincidencia EXACTA (normalizada). Sin match → null, nunca fuzzy. */
export function emparejarExacto<T extends { nombre?: string } | string>(
  valor: string,
  catalogo: readonly T[],
  nombreDe: (item: T) => string = (item) => (typeof item === 'string' ? item : (item as { nombre?: string }).nombre ?? ''),
): T | null {
  const buscado = normalizarTexto(valor);
  if (!buscado) return null;
  return catalogo.find((c) => normalizarTexto(nombreDe(c)) === buscado) ?? null;
}
