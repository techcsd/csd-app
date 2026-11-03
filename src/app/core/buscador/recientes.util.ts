// DG2 — "Recientes" del buscador compacto: últimas 5 rutas elegidas, en
// `localStorage`. Puro + con `Storage` inyectable (parámetro) para poder probarlo
// con un storage de mentira, sin depender de que exista `window.localStorage`.
// Try/catch en cada acceso: si no está disponible se degrada a "sin recientes".

export const RECIENTES_LS_KEY = 'csd.buscador.recientes';
export const RECIENTES_MAX = 5;

/** Lee la lista de rutas recientes (más reciente primero). Nunca lanza. */
export function cargarRecientesIds(storage: Storage | undefined | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECIENTES_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, RECIENTES_MAX);
  } catch {
    return [];
  }
}

/** Agrega `ruta` al frente, dedupe, recorta a `RECIENTES_MAX` y persiste. */
export function guardarRecienteId(storage: Storage | undefined | null, ruta: string): string[] {
  const actuales = cargarRecientesIds(storage);
  const siguiente = [ruta, ...actuales.filter((r) => r !== ruta)].slice(0, RECIENTES_MAX);
  if (storage) {
    try {
      storage.setItem(RECIENTES_LS_KEY, JSON.stringify(siguiente));
    } catch {
      /* best-effort */
    }
  }
  return siguiente;
}
