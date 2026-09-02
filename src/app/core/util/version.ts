/**
 * Compara dos versiones semver "a.b.c" numéricamente por segmentos.
 * Devuelve >0 si a>b, 0 si iguales, <0 si a<b. Segmentos faltantes = 0
 * (espejo de UpdateService.isNewer). Tolera prefijos/sufijos no numéricos.
 */
export function compararVersion(a: string, b: string): number {
  const pa = (a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** true si `version` es mayor o igual que `minima` (o si no hay mínima). */
export function versionAlMenos(version: string, minima?: string | null): boolean {
  if (!minima) return true;
  return compararVersion(version, minima) >= 0;
}
