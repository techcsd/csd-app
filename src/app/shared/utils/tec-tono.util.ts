/**
 * DA2/DA7 — tono semántico de una situación/condición del inventario
 * tecnológico, para pintarla como "punto + palabra" (mockup DA2). Mismo
 * criterio que `estado-tono.ts` del SGC (CB2): situación = dónde está/qué
 * hace, condición = cómo está físicamente — colores independientes.
 */
export type TecTono = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONO_ESTADO: Record<string, TecTono> = {
  activo: 'success',
  en_stock: 'info',
  en_reparacion: 'warning',
  en_prestamo: 'info',
  extraviado: 'danger',
  dado_de_baja: 'neutral',
};

const TONO_CONDICION: Record<string, TecTono> = {
  funciona: 'success',
  averiado: 'danger',
  por_diagnosticar: 'warning',
};

export function tecTonoEstado(clave: string | null | undefined): TecTono {
  return (clave ? TONO_ESTADO[clave] : undefined) ?? 'neutral';
}

export function tecTonoCondicion(clave: string | null | undefined): TecTono {
  return (clave ? TONO_CONDICION[clave] : undefined) ?? 'neutral';
}
