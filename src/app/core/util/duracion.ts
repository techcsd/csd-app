/**
 * U23 — Duración legible a partir de minutos: `88` → `1 h 28 min`, `45` → `45 min`,
 * `120` → `2 h`. Espeja `formatearDuracion` de SGC web. Úsala en toda duración
 * mostrada al usuario (rutas, etc.); nunca "88 minutos".
 */
export function formatearDuracion(minutos: number | string | null | undefined): string {
  if (minutos == null || minutos === '') return '—';
  const total = Math.round(Number(minutos));
  if (isNaN(total) || total < 0) return '—';
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
