/**
 * CM6 (PROMPT-95 F3) — helpers del "tope" del incentivo, compartidos entre la
 * pantalla del chofer (Mi rendimiento) y la de gestión (Incentivos).
 */

/** Etiqueta corta por actividad para el texto del tope por día. */
const ACTIVIDAD_LABEL: Record<string, string> = {
  ruta: 'Rutas',
  conduce: 'Conduces',
  echada: 'Echadas',
  combustible: 'Echadas',
  inspeccion: 'Inspecciones',
  preuso: 'Pre-uso',
  reporte_semanal: 'Reporte',
};

/**
 * Resume los topes POR DÍA de la config (`topes`/`tope_dia` jsonb) a un texto corto
 * tipo "Echadas: 2 por día · Rutas: 4 por día". Acepta valores número (= tope/día) u
 * objetos `{dia, semana}`. Devuelve '' si no hay nada (no se pinta). Defensivo: la
 * forma exacta la fija el padre; si no encaja, degrada a vacío.
 */
export function resumirTopeDia(topes: Record<string, unknown> | null | undefined): string {
  if (!topes || typeof topes !== 'object') return '';
  const partes: string[] = [];
  for (const [k, v] of Object.entries(topes)) {
    let dia: number | null = null;
    if (typeof v === 'number') dia = v;
    else if (v && typeof v === 'object' && typeof (v as { dia?: unknown }).dia === 'number') dia = (v as { dia: number }).dia;
    if (dia == null || dia <= 0) continue;
    const label = ACTIVIDAD_LABEL[k] ?? k;
    partes.push(`${label}: ${dia} por día`);
  }
  return partes.join(' · ');
}
