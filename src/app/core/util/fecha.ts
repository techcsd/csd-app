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

/**
 * Y1 — compacta con hora: `23/07 · 6:41 pm`. Para listas de borradores/envíos
 * ("Guardado …") donde importa el día Y la hora del último guardado. Acepta ms
 * (epoch) o un timestamp ISO.
 */
export function formatFechaCortaHora(ts: string | number | null | undefined): string {
  if (ts == null) return '—';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '—';
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  let h = dt.getHours();
  const min = String(dt.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${d}/${m} · ${h}:${min} ${period}`;
}

/** `timestamptz` → solo la hora `3:45 pm` (12h). Para el pie de cada mensaje del chat. */
export function formatHora(ts: string | null | undefined): string {
  if (!ts) return '';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '';
  let h = dt.getHours();
  const min = String(dt.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${period}`;
}

/**
 * BL9 — `YYYY-MM-DD` del día LOCAL de una fecha (default hoy). Reemplaza el patrón
 * `new Date().toISOString().slice(0,10)`, que devuelve el día en UTC y en UTC-4
 * misclasifica todo lo capturado después de las 20:00 como del día siguiente.
 */
export function fechaLocalISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` local de un timestamp (para comparar días calendario, sin UTC). */
function diaLocal(ts: string | null | undefined): string {
  if (!ts) return '';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** AT14 — true si `a` y `b` caen en días calendario locales distintos (separador de fecha del chat). */
export function esOtroDia(a: string | null | undefined, b: string | null | undefined): boolean {
  return diaLocal(a) !== diaLocal(b);
}

/**
 * BL9 — true si una bitácora está RETROFECHADA: su día (`fecha`, date-only
 * `YYYY-MM-DD`) es distinto al día LOCAL en que se creó (`createdAt`, timestamptz).
 * OJO: `fecha` NO se pasa por `new Date` (un date-only se parsea como UTC medianoche
 * y en UTC-4 se corre al día anterior); se compara como cadena contra el día local
 * del timestamp de creación. Devuelve false si falta cualquiera de los dos.
 */
export function bitacoraRetrofechada(
  fecha: string | null | undefined,
  createdAt: string | null | undefined,
): boolean {
  if (!fecha || !createdAt) return false;
  const creado = diaLocal(createdAt);
  if (!creado) return false;
  return fecha.slice(0, 10) !== creado;
}

/** AT14 — etiqueta del separador de día del chat: `Hoy` / `Ayer` / `14 jul 2026`. */
export function etiquetaDiaChat(ts: string | null | undefined): string {
  const dia = diaLocal(ts);
  if (!dia) return '';
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (dia === fmt(hoy)) return 'Hoy';
  if (dia === fmt(ayer)) return 'Ayer';
  return formatFechaMedia(ts);
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
