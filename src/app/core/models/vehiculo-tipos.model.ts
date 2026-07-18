/**
 * P4 — Catálogo de tipos de vehículo (paridad con el SGC:
 * `src/shared/models/vehiculo.model.ts`). Mantener alineado con la web.
 * El `value` es lo que se guarda en `vehiculos.tipo`; el `label` (RD) es lo
 * que se muestra.
 */
export const VEHICULO_TIPOS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'motocicleta', label: 'Motocicleta' },
  { value: 'automovil', label: 'Automóvil / Sedán' },
  { value: 'suv', label: 'SUV / Jeepeta' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'camion', label: 'Camión' },
  { value: 'excavadora', label: 'Excavadora' },
  { value: 'retroexcavadora', label: 'Retroexcavadora' },
  { value: 'bulldozer', label: 'Bulldozer' },
  { value: 'grua', label: 'Grúa' },
  { value: 'mixer', label: 'Mixer / Hormigonera' },
  { value: 'compactadora', label: 'Compactadora' },
  { value: 'montacargas', label: 'Montacargas' },
  { value: 'otro', label: 'Otro' },
] as const;

/**
 * Tipos considerados "livianos" (afecta el filtrado de ítems del checklist).
 * P4: moto/auto/suv/pickup son livianos; camiones/maquinaria pesados. `otro`
 * se mantiene liviano (comportamiento previo). MISMO conjunto que el SGC.
 */
const TIPOS_LIVIANOS = new Set<string>(['motocicleta', 'automovil', 'suv', 'pickup', 'otro']);

/** Etiqueta legible para un `tipo` guardado (o el valor crudo si no está). */
export function labelTipoVehiculo(tipo: string | null | undefined): string {
  if (!tipo) return '—';
  return VEHICULO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

/** Clase Liviano/Pesado según el tipo (para filtrar ítems del checklist). */
export function claseVehiculo(tipo: string | null | undefined): 'Pesado' | 'Liviano' {
  return TIPOS_LIVIANOS.has((tipo ?? '').trim().toLowerCase()) ? 'Liviano' : 'Pesado';
}

/** Whether a vehicle counts as heavy (shows the Herramienta Pesado section). */
export function esVehiculoPesado(tipo: string | null | undefined): boolean {
  return claseVehiculo(tipo) === 'Pesado';
}
