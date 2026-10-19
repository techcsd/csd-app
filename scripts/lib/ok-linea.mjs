// scripts/lib/ok-linea.mjs — CR3 — gate de la línea "OK:" en qa/release-<version>.md.
// Port idéntico del mismo archivo en SGC (PROMPT-104 FASE 8) — mismo hallazgo real:
// el HANDOFF de CQ muestra "**OK de Xaviel** (pendiente)" colando como un OK real
// porque el `release-check.mjs` de este repo solo buscaba el texto "OK de Xaviel" en
// cualquier parte, sin mirar qué decía alrededor (CR3).
//
// Separado de release-check.mjs (que tiene efectos secundarios en el top-level: exige
// --version) para que scripts/release-check.test.mjs pueda importar SOLO la función.
//
// La línea tiene que EMPEZAR con "OK:" o "**OK de Xaviel**", traer una FECHA, y esa
// misma línea no puede tener "pendiente/falta/no/skip" después del prefijo.
const FECHA_RX = /\b\d{4}-\d{2}-\d{1,2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s*[-\s]?\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zñ]*\.?\s*[-\s]?\s*\d{2,4}\b/i;
const NEGACION_RX = /\b(pendiente|falta|no|skip)\b/i;

export function okLineaValida(contenido) {
  if (!contenido) return false;
  for (const linea of contenido.split('\n')) {
    const t = linea.trim();
    const m = t.match(/^(OK:|\*\*OK de Xaviel\*\*)\s*(.*)$/i);
    if (!m) continue;
    const resto = m[2] ?? '';
    if (FECHA_RX.test(t) && !NEGACION_RX.test(resto)) return true;
  }
  return false;
}
