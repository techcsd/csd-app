/** Days before expiry within which a licence counts as "por vencer". */
export const LICENCIA_POR_VENCER_DIAS = 30; // sgc.flota_config → umbral_licencia_dias

export type LicenciaEstado = 'vigente' | 'por_vencer' | 'vencida' | 'desconocido';

/** The signed-in user's driver profile (sgc.conductores). */
export interface Conductor {
  id: string;
  nombre: string;
  cedula: string;
  licencia_tipo: string;
  licencia_numero: string | null;
  licencia_vencimiento: string | null; // YYYY-MM-DD
  tipo_vehiculo_autorizado: string; // 'Liviano' | 'Pesado' | 'Ambos'
  vehiculo_id: string | null;
  usuario_id: string | null;
  /** C3 — nota libre del conductor (rol descriptivo, observación…). */
  nota: string | null;
  /** C3 — etiquetas (Chofer, Encargado de Logística, Chofer Telehandler…). */
  tags: string[] | null;
}

/** C3 — sugerencias de tags para el chip-input (texto libre permitido). */
export const CONDUCTOR_TAGS_SUGERIDOS = [
  'Chofer',
  'Encargado de Logística',
  'Chofer Telehandler',
  'Operador',
  'Mensajero',
];

/** A system user that can be linked to a driver profile (usuarios_vinculables). */
export interface UsuarioVinculable {
  id: string;
  nombre: string;
  cedula: string | null;
  telefono: string | null;
  email: string | null;
}

/** Aggregated driver stats for the read-only profile (v_conductor_stats, R5). */
export interface ConductorStats {
  conductor_id: string;
  nombre: string;
  licencia_vencimiento: string | null;
  estado_licencia: string | null;
  checklists_total: number;
  checklists_bloqueos: number;
  ultimo_checklist: string | null;
  combustible_echadas: number;
  ultima_echada: string | null;
  vehiculos_usados: number;
  ultima_actividad: string | null;
}

/** Derive licence status from its expiry date (Vigente / Por vencer / Vencida). */
export function estadoLicencia(
  vencimiento: string | null,
  diasUmbral = LICENCIA_POR_VENCER_DIAS, // APP-039 — configurable vía flota_config
): LicenciaEstado {
  if (!vencimiento) return 'desconocido';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(vencimiento + 'T00:00:00');
  const dias = Math.floor((venc.getTime() - hoy.getTime()) / 86_400_000);
  if (dias < 0) return 'vencida';
  if (dias <= diasUmbral) return 'por_vencer';
  return 'vigente';
}

/** Whole days until a date (negative if already past); null when no date. */
export function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(fecha + 'T00:00:00');
  return Math.floor((d.getTime() - hoy.getTime()) / 86_400_000);
}
