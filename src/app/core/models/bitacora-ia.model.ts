import { CampoPropuesto } from '../../shared/utils/bitacora-ia.util';

/**
 * DF1-A (PROMPT 129) — contrato de la edge `bitacora-ia` (SGC, ya desplegada
 * en el Supabase de dev). Entrada: fotos + audio/transcripción + obra + fecha.
 * Salida: propuesta de los campos del parte diario con confianza por campo.
 * Nunca envía sola — el usuario siempre revisa antes de `submit()`.
 */
export const CAMPOS_PARTE_IA = [
  'ingeniero_responsable',
  'hora_fin_trabajo',
  'personal_carpinteria',
  'personal_acero',
  'trabajadores_casa',
  'otro_personal',
  'comentarios',
  'llovio',
  'lluvia_detalle',
  'horas_lluvia',
] as const;

export type CampoParteIaClave = (typeof CAMPOS_PARTE_IA)[number];

export interface ActividadPropuestaIA {
  estructura: string;
  actividad: string;
  cantidad: number | null;
  unidad: string | null;
  confianza: number;
  fuente?: 'voz' | 'foto' | 'ambas';
}

export interface RestriccionPropuestaIA {
  tipo_restriccion: string;
  descripcion_otro: string | null;
  confianza: number;
  fuente?: 'voz' | 'foto' | 'ambas';
}

export interface PropuestaBitacoraIA {
  ok: boolean;
  propuesta_id?: string | null;
  campos?: Partial<Record<CampoParteIaClave, CampoPropuesto>>;
  actividades?: ActividadPropuestaIA[];
  restricciones?: RestriccionPropuestaIA[];
  confianza_media?: number;
  modelo?: string;
  error?: string;
  error_code?: string;
  transcripcion?: string;
}
