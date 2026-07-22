export type CombustibleNivel = 'E' | '1/4' | '1/2' | '3/4' | 'F';
/**
 * V5 — ÚNICA lista de niveles de combustible de la app (pre-uso, reporte
 * semanal, recibir/devolver y combustible). Incluye "E" (reserva) y usa "F"
 * (lleno). El histórico guardado como 'Lleno' se sigue leyendo bien (ver
 * `nivelCombustibleLabel`).
 */
export const NIVELES_COMBUSTIBLE: CombustibleNivel[] = ['E', '1/4', '1/2', '3/4', 'F'];
/** V5 — leyenda única del selector de nivel. */
export const NIVEL_COMBUSTIBLE_AYUDA = 'E = reserva · F = lleno';
/** V5 — normaliza un nivel guardado para mostrarlo (histórico 'Lleno' → 'F'). */
export function nivelCombustibleLabel(v: string | null | undefined): string {
  if (!v) return '—';
  return v === 'Lleno' ? 'F' : v;
}

export type EntregaTipo = 'recepcion' | 'devolucion';

/** The 6 mandatory guided shots for a vehicle checklist (VEH-01). */
export const FOTOS_REQUERIDAS = [
  { slot: 'frente', label: 'Frente', hint: '🚙' },
  { slot: 'atras', label: 'Atrás', hint: '🚙' },
  { slot: 'lado_izq', label: 'Lado izquierdo', hint: '🚙' },
  { slot: 'lado_der', label: 'Lado derecho', hint: '🚙' },
  { slot: 'tablero', label: 'Tablero (con km)', hint: '🎛️' },
  { slot: 'combustible', label: 'Nivel de combustible', hint: '⛽' },
] as const;

/** Damage zones that map to the vehicle silhouette. */
export const ZONAS_DANO = [
  { zona: 'frente', label: 'Frente' },
  { zona: 'atras', label: 'Atrás' },
  { zona: 'lado_izq', label: 'Lado izq.' },
  { zona: 'lado_der', label: 'Lado der.' },
  { zona: 'techo', label: 'Techo' },
  { zona: 'interior', label: 'Interior' },
  { zona: 'cristales', label: 'Cristales' },
  { zona: 'gomas', label: 'Gomas' },
] as const;

/** Extended vehicle header for pre-use (blocks + maintenance line). */
export interface VehiculoDetalle {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  kilometraje: number;
  vencimiento_matricula: string | null;
  vencimiento_seguro: string | null;
  km_ultimo_mantenimiento: number | null;
  intervalo_mantenimiento_km: number | null;
  /** S20 — rendimiento de referencia definido por el usuario (esperado). */
  rendimiento_esperado_km_gal?: number | null;
}

export interface VehiculoACargo {
  entrega_id: string;
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  km: number;
  desde: string;
}

export interface VehiculoPorRecibir {
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  km: number;
}

export interface PendientesTransporte {
  a_cargo: VehiculoACargo[];
  por_recibir: VehiculoPorRecibir[];
}

/** A vehicle available for self-assignment (estado disponible). */
export interface VehiculoDisponible {
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  km: number;
  /** U6 — path de la 1ª foto en el bucket `vehiculos` (o null). */
  foto_path?: string | null;
}

/** An active self/admin assignment from sgc.vehiculo_asignaciones. */
export interface MiAsignacion {
  asignacion_id: string;
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  km: number;
  desde: string;
  origen: string;
}

/** Result of asignarme_vehiculo() — enough to chain into the recepción flow. */
export interface AsignacionResultado {
  asignacion_id: string;
  vehiculo_id: string;
  conductor_id: string | null;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  kilometraje: number;
  vencimiento_matricula: string | null;
  vencimiento_seguro: string | null;
  proximo_mantenimiento_km: number | null;
}

/** Aggregated vehicle stats for the read-only profile (v_vehiculo_stats, R4). */
export interface VehiculoStats {
  vehiculo_id: string;
  placa: string;
  km_actual: number | null;
  combustible_echadas: number;
  combustible_galones: number | null;
  combustible_monto: number | null;
  rendimiento_promedio: number | null;
  costo_por_km_promedio: number | null;
  ultima_echada: string | null;
  checklists_total: number;
  checklists_bloqueos: number;
  ultimo_checklist: string | null;
  mantenimientos_total: number;
  ultimo_mantenimiento: string | null;
  km_ultimo_mantenimiento: number | null;
  proximo_mantenimiento_km: number | null;
  asignaciones_activas: number;
  ultima_actividad: string | null;
}

/** A damage entry captured in the checklist (photo blob held until sync). */
export interface DanoCaptura {
  zona: string;
  descripcion: string;
}

export interface ConduceItem {
  detalle_id: string;
  articulo: string;
  unidad: string;
  cantidad: number;
}

export interface Conduce {
  id: string;
  fecha: string;
  estado: string;
  destino: string | null;
  bodega: string | null;
  items: ConduceItem[];
}

export interface RutaHoy {
  id: string;
  origen: string;
  destino: string;
  estado: string;
  fecha: string;
  /** W4 — notas de la ruta (se capturaban pero no se mostraban). */
  notas?: string | null;
}
