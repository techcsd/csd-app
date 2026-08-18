/**
 * AV9 — Cédula RD. El sistema guarda/envía SOLO dígitos; la UI muestra el
 * formato con guiones `XXX-XXXXXXX-X`. Espeja el patrón de `telefono.ts`.
 * `soloDigitosCedula` normaliza (para enviar/guardar); `formatCedula` para
 * mostrar y para la máscara en vivo mientras se teclea.
 */

/** Deja solo los dígitos (para enviar/guardar). Máx 11 (cédula RD). */
export function soloDigitosCedula(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '').slice(0, 11);
}

/**
 * Formatea a `XXX-XXXXXXX-X` de forma progresiva mientras se escribe.
 * Los guiones son SOLO visuales; pegar con o sin guiones funciona (se
 * re-derivan de los dígitos). Devuelve el texto tal cual si no hay dígitos.
 */
export function formatCedula(v: string | null | undefined): string {
  const d = soloDigitosCedula(v);
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
}
