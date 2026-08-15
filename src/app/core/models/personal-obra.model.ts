// AR1 — Registro de Personal de obra (app). Espeja el modelo de SGC (misma
// entidad/contrato) para que el carnet/QR y el expediente coincidan con la web.

export type Nacionalidad = 'dominicano' | 'haitiano' | 'otro';
export type TipoDocumento = 'cedula' | 'pasaporte' | 'carnet_electoral' | 'ninguno';
export type EstadoPersonal = 'activo' | 'inactivo';

/** Los 5 tipos de foto de evidencia (en el orden del expediente). */
export type FotoTipo = 'persona' | 'documento' | 'pared' | 'carnet' | 'persona_carnet_cedula';

export interface Cargo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  activo: boolean;
  orden: number;
}

export interface PersonalFoto {
  id: string;
  personal_id: string;
  tipo: FotoTipo;
  foto_path: string;
  created_at: string;
}

export interface PersonalFirma {
  id: string;
  personal_id: string;
  plantilla_id?: string | null;
  documento_nombre: string;
  firma_path: string;
  documento_path?: string | null;
  metodo: 'pad' | 'foto';
  firmado_at: string;
}

export interface PersonalObra {
  id: string;
  proyecto_id: string;
  nombre: string;
  apellido?: string | null;
  nacionalidad: Nacionalidad;
  tipo_documento: TipoDocumento;
  documento_numero?: string | null;
  cargo_id?: string | null;
  empleado_id?: string | null;
  telefono?: string | null;
  notas?: string | null;
  carnet_numero?: string | null;
  carnet_emitido_at?: string | null;
  carnet_emitido_por?: string | null;
  estado: EstadoPersonal;
  es_prueba?: boolean;
  registrado_por?: string | null;
  created_at: string;
  updated_at: string;
  // joins
  cargo?: Cargo | null;
  proyecto?: { nombre: string; codigo?: string | null } | null;
}

export interface PersonalConteos {
  total: number;
  por_cargo: { cargo: string; codigo: string | null; total: number }[];
  por_nacionalidad: { nacionalidad: string; total: number }[];
}

export const NACIONALIDADES: { value: Nacionalidad; label: string; icon: string }[] = [
  { value: 'dominicano', label: 'Dominicano', icon: '🇩🇴' },
  { value: 'haitiano', label: 'Haitiano', icon: '🇭🇹' },
  { value: 'otro', label: 'Otra', icon: '🌎' },
];

export const TIPOS_DOCUMENTO: { value: TipoDocumento; label: string; icon: string }[] = [
  { value: 'cedula', label: 'Cédula', icon: '🪪' },
  { value: 'pasaporte', label: 'Pasaporte', icon: '📘' },
  { value: 'carnet_electoral', label: 'Carnet electoral', icon: '🗳️' },
  { value: 'ninguno', label: 'Sin documento', icon: '🚫' },
];

/** Guía de las 5 fotos del expediente (orden + instrucción en pantalla). */
export const FOTOS_GUIA: { tipo: FotoTipo; label: string; ayuda: string; hint: string }[] = [
  { tipo: 'persona', label: 'Foto de la persona', ayuda: 'Rostro visible, de frente.', hint: '🧍' },
  { tipo: 'documento', label: 'Foto del documento', ayuda: 'Cédula o pasaporte, legible.', hint: '🪪' },
  { tipo: 'pared', label: 'Foto pegado a la pared', ayuda: 'Cuerpo de frente contra la pared (tipo ficha).', hint: '🧱' },
  { tipo: 'carnet', label: 'Foto del carnet', ayuda: 'El carnet entregado, legible.', hint: '🎫' },
  { tipo: 'persona_carnet_cedula', label: 'Persona con carnet y cédula', ayuda: 'Sosteniendo el carnet y la cédula, rostro visible.', hint: '🤳' },
];

export const NACIONALIDAD_LABEL: Record<string, string> = {
  dominicano: 'Dominicano',
  haitiano: 'Haitiano',
  otro: 'Otra',
};

export const ESTADO_LABEL: Record<string, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
};
