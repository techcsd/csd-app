import { CampoPropuesto } from '../../shared/utils/bitacora-ia.util';

/**
 * DF1-B..E (PROMPT 129) — contrato de la edge genérica `leer-formulario` (SGC,
 * ya desplegada en el Supabase de dev). Un solo endpoint, parámetro `tipo`.
 * Solo 4 tipos están implementados del lado del servidor hoy: 'conduce_externo',
 * 'mantenimiento', 'checklist_vehiculo', 'requisicion'. 'factura_general' y
 * 'ruta' no tienen pantalla/contrato real todavía — no se construyó UI para
 * esos (ver HANDOFF).
 */
export type TipoFormularioIA = 'conduce_externo' | 'mantenimiento' | 'checklist_vehiculo' | 'requisicion';

export interface ItemPropuestoIA {
  articulo: string;
  cantidad: number | null;
  unidad: string | null;
  confianza: number;
}

interface RespuestaBase {
  ok: boolean;
  propuesta_id?: string | null;
  confianza_media?: number;
  modelo?: string;
  error?: string;
  error_code?: string;
}

export interface PropuestaConduceIA extends RespuestaBase {
  material?: CampoPropuesto<string>;
  proveedor_sugerido?: CampoPropuesto<string>;
  items?: ItemPropuestoIA[];
}

export interface PropuestaMantenimientoIA extends RespuestaBase {
  descripcion?: CampoPropuesto<string>;
  vehiculo_sugerido?: CampoPropuesto<string>;
  tipo?: CampoPropuesto<'preventivo' | 'correctivo'>;
}

export interface RespuestaChecklistIA {
  id: string;
  respuesta: 'ok' | 'no';
  comentario: string | null;
  confianza: number;
}

export interface PropuestaChecklistIA extends RespuestaBase {
  respuestas?: RespuestaChecklistIA[];
}

export interface PropuestaRequisicionIA extends RespuestaBase {
  items?: ItemPropuestoIA[];
  obra_mencionada?: CampoPropuesto<string>;
  urgencia?: CampoPropuesto<'normal' | 'urgente'>;
}
