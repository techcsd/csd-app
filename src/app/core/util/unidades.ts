/**
 * AU13/BC2 — unidades de medida para el desplegable de material NO catalogado.
 * Se ofrece el catálogo de la BD (sgc.unidades) combinado con un set común, con
 * "UND" primero (default) y permitiendo texto libre (el que teclea el usuario se
 * conserva aunque no esté en la lista). Fuente única para requisición y edición.
 */
export const UNIDADES_COMUNES = [
  'UND', 'm', 'm²', 'm³', 'pie', 'qq', 'kg', 'lb', 'gal',
  'lata', 'saco', 'funda', 'caja', 'rollo', 'varilla', 'par', 'juego',
];

/** Une las unidades comunes con las del catálogo (sin duplicar, UND primero). */
export function combinarUnidades(cat: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...UNIDADES_COMUNES, ...cat]) {
    const t = (u ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
