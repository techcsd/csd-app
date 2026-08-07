/**
 * AI4 (refina U23) — Duración legible a partir de minutos:
 *   `< 60`   → `45 min`
 *   `>= 60`  → `16h 51m`  (o `2h` si no hay minutos)
 *   `>= 24h` → `1d 2h`    (o `3d` si no hay horas)
 * Espeja `formatearDuracion` de SGC web. Úsala en TODA duración mostrada al
 * usuario (rutas, conduces, etc.); nunca minutos crudos ("1011 minutos").
 */
export function formatearDuracion(minutos: number | string | null | undefined): string {
  if (minutos == null || minutos === '') return '—';
  const total = Math.round(Number(minutos));
  if (isNaN(total) || total < 0) return '—';
  if (total < 60) return `${total} min`;
  if (total < 1440) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
