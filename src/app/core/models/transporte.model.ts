export type CombustibleNivel = 'E' | '1/4' | '1/2' | '3/4' | 'F';
export const NIVELES_COMBUSTIBLE: CombustibleNivel[] = ['E', '1/4', '1/2', '3/4', 'F'];

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
}
