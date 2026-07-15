/**
 * U9 — Fechas legibles es-DO para toda la app. Construidas a mano (sin depender
 * de datos de locale de Intl, que en el WebView de Android pueden faltar).
 * Espeja las utilidades de SGC web (formatFechaMedia/Humana/Relativa).
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `YYYY-MM-DD` (date-only) → `02/07/2026`. Parte local, sin corrimiento UTC. */
export function formatFecha(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const [y, m, d] = fecha.slice(0, 10).split('-');
  if (!y || !m || !d) return fecha;
  return `${d}/${m}/${y}`;
}

/** `timestamptz` → `14 jul 2026` (sin hora). El offset `Z` hace `new Date` correcto. */
export function formatFechaMedia(ts: string | null | undefined): string {
  if (!ts) return '—';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '—';
  return `${dt.getDate()} ${MESES[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** `timestamptz` → `14 jul 2026, 3:45 p. m.`. */
export function formatFechaHumana(ts: string | null | undefined): string {
  if (!ts) return '—';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '—';
  let h = dt.getHours();
  const min = String(dt.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12;
  if (h === 0) h = 12;
  return `${dt.getDate()} ${MESES[dt.getMonth()]} ${dt.getFullYear()}, ${h}:${min} ${period}`;
}

/** Relativa corta ("hace 5 min", "ayer"); >~2 días cae a `formatFechaHumana`. */
export function formatFechaRelativa(ts: string | null | undefined): string {
  if (!ts) return '—';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '—';
  const secs = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (secs < 0) return formatFechaHumana(ts);
  if (secs < 60) return 'hace un momento';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'ayer';
  if (days < 3) return `hace ${days} días`;
  return formatFechaHumana(ts);
}
