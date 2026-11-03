// DG2 — Buscador compacto: coincidencia tolerante SIN dependencias nuevas. Mismo
// algoritmo que el buscador maestro de la web (paridad de matching) — función
// PURA (sin Angular/servicios) para poder probarla con vitest sin montar nada.

/** Una fila del índice de navegación de la app (ver `buscador-indice.ts`). */
export interface IndiceBuscadorEntry {
  id: string;
  titulo: string;
  ruta: string;
  /** Solo el título (la app no tiene jerarquía de grupo>hijo como el sidebar web). */
  camino: string;
  modulo?: string;
  palabrasClave: string[];
}

/** Quita acentos/diacríticos y normaliza a minúsculas, para comparar "conduce" con
 *  "Condúce" o "CONDUCE" sin diferencias. */
export function normalizarTexto(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Tokeniza en palabras sueltas (separadas por espacios/puntuación), ya normalizadas. */
export function tokenizar(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 0);
}

/**
 * Distancia de edición acotada a `maxDist` (Damerau-Levenshtein: inserción, borrado,
 * sustitución y transposición de 2 letras adyacentes). Devuelve `maxDist + 1` si la
 * distancia real es mayor (early-exit barato para palabras muy distintas).
 */
export function distanciaEdicion(a: string, b: string, maxDist = 2): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;

  const d: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;

  for (let i = 1; i <= la; i++) {
    let mejorFila = Infinity;
    for (let j = 1; j <= lb; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + costo,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      if (v < mejorFila) mejorFila = v;
    }
    if (mejorFila > maxDist && i > maxDist) return maxDist + 1;
  }
  return Math.min(d[la][lb], maxDist + 1);
}

type NivelPalabra = 'exacta' | 'prefijo' | 'aproximada' | null;

function coincidePalabra(query: string, palabra: string): NivelPalabra {
  if (palabra === query) return 'exacta';
  if (palabra.startsWith(query)) return 'prefijo';
  // Tolerancia de 1-2 letras — solo para palabras de 3+ letras.
  if (query.length >= 3) {
    const maxDist = query.length <= 4 ? 1 : 2;
    if (distanciaEdicion(query, palabra, maxDist) <= maxDist) return 'aproximada';
  }
  return null;
}

export interface ResultadoBusqueda {
  entrada: IndiceBuscadorEntry;
  puntaje: number;
  /** Índices [inicio, fin) dentro de `entrada.camino` que hicieron match, para resaltar. */
  resaltar: Array<[number, number]>;
}

/**
 * Evalúa una entrada del índice contra el texto de búsqueda. Devuelve `null` si no
 * matchea. Reglas (en orden de prioridad para el ranking):
 *  1. Coincidencia EXACTA del título completo.
 *  2. El título empieza por el texto escrito (prefijo).
 *  3. Todas las palabras del texto aparecen (exacta/prefijo) en el camino, en
 *     cualquier orden.
 *  4. Igual que (3) pero con tolerancia de 1-2 letras por palabra.
 */
export function evaluarCoincidencia(query: string, entrada: IndiceBuscadorEntry): ResultadoBusqueda | null {
  const qNorm = normalizarTexto(query);
  if (!qNorm) return null;

  const tituloNorm = normalizarTexto(entrada.titulo);

  if (tituloNorm === qNorm) {
    return { entrada, puntaje: 1000, resaltar: resaltarEnTexto(entrada.camino, [qNorm]) };
  }
  if (tituloNorm.startsWith(qNorm)) {
    return { entrada, puntaje: 900, resaltar: resaltarEnTexto(entrada.camino, [qNorm]) };
  }

  const qPalabras = tokenizar(qNorm);
  const candidatos = entrada.palabrasClave.length ? entrada.palabrasClave : tokenizar(normalizarTexto(entrada.camino));
  const rango: Record<Exclude<NivelPalabra, null>, number> = { aproximada: 1, prefijo: 2, exacta: 3 };

  let todasExactasOPrefijo = true;
  let sumaCalidad = 0;
  const palabrasAMarcar: string[] = [];

  for (const qp of qPalabras) {
    let mejor: NivelPalabra = null;
    for (const cand of candidatos) {
      const nivel = coincidePalabra(qp, cand);
      if (!nivel) continue;
      if (!mejor || rango[nivel] > rango[mejor]) mejor = nivel;
      if (mejor === 'exacta') break;
    }
    if (!mejor) return null;
    if (mejor === 'aproximada') todasExactasOPrefijo = false;
    sumaCalidad += rango[mejor];
    palabrasAMarcar.push(qp);
  }

  if (todasExactasOPrefijo) {
    return { entrada, puntaje: 700 + sumaCalidad, resaltar: resaltarEnTexto(entrada.camino, palabrasAMarcar) };
  }
  return { entrada, puntaje: 400 + sumaCalidad, resaltar: resaltarEnTexto(entrada.camino, palabrasAMarcar) };
}

/** Encuentra los rangos [inicio, fin) de cada palabra dentro de `texto` (case/acento
 *  insensible) para que la UI pueda resaltarlos con `<mark>`. */
function resaltarEnTexto(texto: string, palabras: string[]): Array<[number, number]> {
  const norm = normalizarTexto(texto);
  const rangos: Array<[number, number]> = [];
  for (const p of palabras) {
    if (!p) continue;
    const idx = norm.indexOf(p);
    if (idx >= 0) rangos.push([idx, idx + p.length]);
  }
  return rangos.sort((a, b) => a[0] - b[0]);
}

/** Busca y ordena. Límite por defecto de 9 resultados visibles. */
export function buscarEnIndice(
  query: string,
  indice: IndiceBuscadorEntry[],
  limite = 9,
): ResultadoBusqueda[] {
  const resultados: ResultadoBusqueda[] = [];
  for (const entrada of indice) {
    const r = evaluarCoincidencia(query, entrada);
    if (r) resultados.push(r);
  }
  resultados.sort((a, b) => b.puntaje - a.puntaje || a.entrada.titulo.localeCompare(b.entrada.titulo));
  return resultados.slice(0, limite);
}
