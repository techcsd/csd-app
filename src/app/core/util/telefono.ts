/**
 * U5 — Teléfono RD. Guardar dígitos; mostrar formateado `(809) 555-1234`.
 * Espeja la utilidad de SGC web. `soloDigitos` normaliza para guardar;
 * `formatearTelefono` para mostrar/escribir en vivo.
 */

/** Deja solo los dígitos (para guardar en BD). Máx 10 (RD sin código de país). */
export function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '').slice(0, 10);
}

/** Formatea a `(809) 555-1234` de forma progresiva mientras se escribe. */
export function formatearTelefono(v: string | null | undefined): string {
  const d = soloDigitos(v);
  if (!d) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
