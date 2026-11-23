// DX11 — mínimo de caracteres de un motivo (espeja el servidor: rechazar_solicitud_material y
// anular_conduce exigen >= 10 caracteres sin espacios sobrantes). Una sola fuente en la app.
export const MOTIVO_MIN = 10;

export function motivoLongitud(texto: string | null | undefined): number {
  return (texto ?? '').trim().length;
}

/** Cuántos caracteres faltan para llegar al mínimo (0 = ya cumple). */
export function motivoFalta(texto: string | null | undefined): number {
  return Math.max(0, MOTIVO_MIN - motivoLongitud(texto));
}
