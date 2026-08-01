/**
 * Combustible (fuel) capture model — mirrors sgc.registrar_combustible_app.
 * The chofer digits only 3 numbers (km, galones, monto); the server (and, for
 * a live preview, the client) derives everything else. Thresholds mirror
 * sgc.flota_config; the server is the source of truth (offline preview only).
 */

/** % below the vehicle's average km/gal that flags abnormal consumption. */
export const CONSUMO_ANORMAL_PCT = 20; // sgc.flota_config → umbral_consumo_pct
/** Minimum historical fill-ups before an abnormal-consumption alert can fire. */
export const MIN_ECHADAS_ALERTA = 3;

// AD7 — estados de rendimiento (espejan sgc.clasificar_rendimiento). El servidor
// es la fuente de verdad; en el flujo mostramos un cálculo local con los umbrales
// por defecto (se confirma al sincronizar). El histórico usa el estado persistido.
export type RendimientoEstado = 'optimo' | 'bajo' | 'anormal' | 'datos_insuficientes';

export interface RendimientoEstadoMeta {
  label: string;
  icon: string;
  tone: 'success' | 'warning' | 'error' | 'muted';
}

export const RENDIMIENTO_ESTADO_META: Record<RendimientoEstado, RendimientoEstadoMeta> = {
  optimo: { label: 'Óptimo', icon: '✅', tone: 'success' },
  bajo: { label: 'Bajo', icon: '🟡', tone: 'warning' },
  anormal: { label: 'Anormal', icon: '⚠️', tone: 'error' },
  datos_insuficientes: { label: 'Datos insuficientes', icon: 'ℹ️', tone: 'muted' },
};

/** Umbrales por defecto de sgc.flota_config (para el preview offline del flujo). */
export const DIST_MIN_KM = 50; // dist_min_km
export const REND_MIN_KM_GAL = 10; // rendimiento_minimo_km_gal
export const REND_MAX_KM_GAL = 35; // rendimiento_maximo_km_gal
export const UMBRAL_ANORMAL_PCT = 40; // umbral_anormal_pct

/**
 * AD7 — clasificación local de rendimiento (preview del flujo). Espeja la lógica
 * de sgc.clasificar_rendimiento con los umbrales por defecto. El caso real de
 * Xaviel (echada a ~10 km) cae determinísticamente en 'datos_insuficientes'.
 */
export function clasificarRendimientoLocal(
  kmRecorridos: number | null,
  galones: number | null,
  rendimiento: number | null,
  baseline: number | null,
): { estado: RendimientoEstado; motivo: string } {
  if (kmRecorridos == null) {
    return {
      estado: 'datos_insuficientes',
      motivo: 'Primera echada del vehículo — aún sin distancia para comparar el rendimiento.',
    };
  }
  if (!galones || galones <= 0 || rendimiento == null) {
    return {
      estado: 'datos_insuficientes',
      motivo: 'No hay galones/lectura suficientes para calcular el rendimiento.',
    };
  }
  if (kmRecorridos < DIST_MIN_KM) {
    return {
      estado: 'datos_insuficientes',
      motivo: `Solo ${Math.round(kmRecorridos)} km desde la última echada (se necesitan al menos ${DIST_MIN_KM} km entre tanques llenos). El rendimiento real solo es medible de tanque lleno a tanque lleno.`,
    };
  }
  if (rendimiento < REND_MIN_KM_GAL) {
    return {
      estado: 'anormal',
      motivo: `Rendimiento imposiblemente bajo: ${rendimiento.toFixed(1)} km/gal. Posible fuga, falla mecánica, combustible desviado o error de lectura.`,
    };
  }
  if (rendimiento > REND_MAX_KM_GAL) {
    return {
      estado: 'anormal',
      motivo: `Rendimiento imposiblemente alto: ${rendimiento.toFixed(1)} km/gal. Probable error de odómetro o una echada anterior sin registrar.`,
    };
  }
  if (baseline != null && baseline > 0) {
    const dev = Math.abs(rendimiento - baseline) / baseline;
    if (dev > UMBRAL_ANORMAL_PCT / 100) {
      return {
        estado: 'anormal',
        motivo: `Rendimiento fuera de rango: ${rendimiento.toFixed(1)} vs. lo esperado ≈ ${baseline.toFixed(1)} km/gal (desviación mayor al ${UMBRAL_ANORMAL_PCT}%). Revisar el vehículo o la lectura.`,
      };
    }
    if (rendimiento < baseline * (1 - CONSUMO_ANORMAL_PCT / 100)) {
      return {
        estado: 'bajo',
        motivo: `Rinde ${rendimiento.toFixed(1)} km/gal, por debajo de lo normal (≈ ${baseline.toFixed(1)}) pero dentro de un margen explicable. Vale la pena vigilarlo.`,
      };
    }
  }
  return {
    estado: 'optimo',
    motivo:
      baseline != null && baseline > 0
        ? `Rendimiento dentro de lo esperado para este vehículo (≈ ${baseline.toFixed(1)} km/gal). Consumo normal.`
        : `Rendimiento de ${rendimiento.toFixed(1)} km/gal dentro de rangos coherentes. Aún sin baseline propio suficiente para comparar.`,
  };
}

/** Header of a vehicle's previous fill-up, for live validation + km/gal calc. */
export interface UltimaEchada {
  /** km of the vehicle's most recent fill-up (odometer never goes back). */
  km: number | null;
  fecha: string | null;
  /** Average km/gal across the vehicle's history (null if none recorded). */
  promedio_rendimiento: number | null;
  /** How many fill-ups have a rendimiento on record. */
  n_echadas: number;
}

/** Input the combustible wizard hands to registrar(). */
export interface CombustibleCaptura {
  // Z23-app — nulo en una echada de tarjeta-persona (sin vehículo).
  vehiculoId: string | null;
  conductorId: string | null;
  fecha: string; // YYYY-MM-DD
  // Z23-app — nulo en una echada de persona (no hay odómetro).
  kilometraje: number | null;
  galones: number;
  monto: number;
  estacion: string | null;
  // AC11 — origen de la echada. 'deposito_obra' = garrafón/depósito en obra
  // (telehandler): sin estación ni precio de bomba, con obra y evidencia foto.
  origen: 'estacion' | 'deposito_obra';
  // AC11 — proyecto/obra donde se echó (solo depósito en obra; opcional).
  proyectoId: string | null;
  // Z23-app — campos de conciliación con el reporte del proveedor.
  producto: string | null; // 'diesel' | 'gasolina'
  subtipo: string | null; // AA20 — 'regular' | 'premium'
  tarjeta: string | null; // tarjeta usada (opcional)
  // Z23-app — titular de la tarjeta cuando es de una persona (no de un vehículo).
  titular: string | null;
  titularEsPersona: boolean;
  // AC11 — en depósito en obra no hay recibo/tablero/bomba: solo una foto de
  // evidencia del equipo/garrafón. En estación siguen las 3 (recibo + tablero + bomba).
  fotoRecibo: Blob | null;
  // Z23-app — sin foto de tablero en una echada de persona (no hay odómetro).
  fotoTablero: Blob | null;
  fotoBomba: Blob | null; // Y4 — bomba/estación en 0
  fotoEvidencia: Blob | null; // AC11 — evidencia del equipo/garrafón (depósito en obra)
  placa: string;
}

/** AA20 — precio oficial vigente por producto canónico (referencia/widget). */
export interface PrecioCombustibleVigente {
  producto: string; // gasolina_regular | gasolina_premium | diesel_regular | diesel_premium
  precio: number; // RD$/galón
  vigencia_desde: string;
  fuente: string;
}

/** AA20 — etiqueta legible de un producto canónico (espeja el SGC). */
export const PRODUCTO_CANONICO_LABEL: Record<string, string> = {
  gasolina_regular: 'Gasolina Regular',
  gasolina_premium: 'Gasolina Premium',
  diesel_regular: 'Diésel Regular',
  diesel_premium: 'Diésel Óptimo',
};

/** AA20 — producto canónico a partir de producto (gasolina|diesel) + subtipo. */
export function productoCanonico(
  producto: string | null,
  subtipo: string | null,
): string | null {
  if (!producto) return null;
  return subtipo ? `${producto}_${subtipo}` : producto;
}

/** Live client-side derivation shown before saving (mirrors the server). */
export interface CombustibleCalculo {
  precioPorGalon: number | null;
  kmRecorridos: number | null;
  rendimiento: number | null;
  costoPorKm: number | null;
  /** true when consumption is >CONSUMO_ANORMAL_PCT% below the vehicle average. */
  alertaConsumo: boolean;
  // AD7 — estado preview (se confirma al sincronizar con el servidor).
  estado: RendimientoEstado;
  estadoMotivo: string;
}

/**
 * Compute the derived values the same way the RPC does, for the live box and
 * the confirmation screen. Offline this is all the chofer sees; online it
 * matches what the server persists (same avg, same km_anterior, same threshold).
 */
export function calcularCombustible(
  km: number | null,
  galones: number | null,
  monto: number | null,
  ultima: UltimaEchada,
): CombustibleCalculo {
  const g = galones && galones > 0 ? galones : null;
  const m = monto && monto > 0 ? monto : null;
  const precioPorGalon = g && m ? m / g : null;

  const kmRecorridos =
    km != null && ultima.km != null && km > ultima.km ? km - ultima.km : null;
  const rendimiento = kmRecorridos != null && g ? kmRecorridos / g : null;
  const costoPorKm = kmRecorridos != null && kmRecorridos > 0 && m ? m / kmRecorridos : null;

  const baseline =
    ultima.promedio_rendimiento != null && ultima.n_echadas >= MIN_ECHADAS_ALERTA
      ? ultima.promedio_rendimiento
      : null;

  // alertaConsumo: heurística clásica de "20% bajo el promedio propio" (sin cambios;
  // alimenta el aviso en vivo del paso). AD7: el ESTADO calibrado (4 valores) es
  // aparte y espeja al server para el preview de la confirmación.
  let alertaConsumo = false;
  if (rendimiento != null && baseline != null) {
    alertaConsumo = rendimiento < (1 - CONSUMO_ANORMAL_PCT / 100) * baseline;
  }

  const { estado, motivo } = clasificarRendimientoLocal(kmRecorridos, g, rendimiento, baseline);

  return { precioPorGalon, kmRecorridos, rendimiento, costoPorKm, alertaConsumo, estado, estadoMotivo: motivo };
}
