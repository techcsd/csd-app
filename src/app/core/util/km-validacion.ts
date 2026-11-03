import { ValidacionKm } from '../services/combustible.service';
import { formatFecha } from './fecha';

/**
 * DH2 — `v.mensaje` (texto del RPC `validar_km_vehiculo`) a veces no dice CONTRA QUÉ
 * chocó el km (ej. "La lectura (59547 km) no puede ser menor a la lectura actual del
 * vehículo (63523 km)" no dice de quién/cuándo es esa lectura). Cuando el servidor
 * manda `fuente_antes`/`fecha_antes`/`km_antes` los añade entre paréntesis para que el
 * chofer vea CONTRA QUÉ está chocando antes de pedir ayuda a Flota. Usado por
 * combustible.ts y mantenimiento.ts (mismo RPC, mismo contrato `ValidacionKm`).
 */
export function mensajeKmRico(v: ValidacionKm | null, fallback: string): string {
  if (!v || v.nivel !== 'error' || !v.mensaje) return fallback;
  if (!v.fuente_antes && !v.fecha_antes) return v.mensaje;
  const partes: string[] = [];
  if (v.fuente_antes) partes.push(v.fuente_antes);
  if (v.fecha_antes) partes.push(formatFecha(v.fecha_antes));
  if (v.km_antes != null) partes.push(`${v.km_antes} ${v.unidad || 'km'}`);
  return `${v.mensaje} (${partes.join(' · ')})`;
}
