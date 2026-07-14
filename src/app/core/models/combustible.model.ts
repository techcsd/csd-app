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
  vehiculoId: string;
  conductorId: string | null;
  fecha: string; // YYYY-MM-DD
  kilometraje: number;
  galones: number;
  monto: number;
  estacion: string | null;
  fotoRecibo: Blob;
  fotoTablero: Blob;
  placa: string;
}

/** Live client-side derivation shown before saving (mirrors the server). */
export interface CombustibleCalculo {
  precioPorGalon: number | null;
  kmRecorridos: number | null;
  rendimiento: number | null;
  costoPorKm: number | null;
  /** true when consumption is >CONSUMO_ANORMAL_PCT% below the vehicle average. */
  alertaConsumo: boolean;
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

  let alertaConsumo = false;
  if (
    rendimiento != null &&
    ultima.promedio_rendimiento != null &&
    ultima.n_echadas >= MIN_ECHADAS_ALERTA
  ) {
    alertaConsumo = rendimiento < (1 - CONSUMO_ANORMAL_PCT / 100) * ultima.promedio_rendimiento;
  }

  return { precioPorGalon, kmRecorridos, rendimiento, costoPorKm, alertaConsumo };
}
