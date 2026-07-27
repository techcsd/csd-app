// CSD-OPE-01 §6.8/§9 — Checklists de Liberación (CL-01..07), captura de campo.

export interface ClPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string | null;
  etiqueta: string;
  orden: number | null;
}

export interface ClPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  fase: string | null;
  orden: number | null;
  items: ClPlantillaItem[];
}

export interface ClProyecto {
  id: string;
  nombre: string;
}

// Z2 — responsable/residente del proyecto ligado a un USUARIO real (para firmar).
export type TipoResponsabilidad = 'residente' | 'responsable';
export interface ClResponsable {
  id: string;
  usuario_id: string;
  nombre: string;
  email: string | null;
  tipo_responsabilidad: TipoResponsabilidad;
}

// Ciclo de firmas del procedimiento.
export type ClFirmaRol = 'maestro' | 'residente' | 'responsable' | 'cliente' | 'mivhed';

// Z3 — la liberación exige RESIDENTE **o** RESPONSABLE (el trigger sgc.trg_cl_firmado
// pasa a 'firmado' con cualquiera de las dos). Cliente/MIVHED/maestro opcionales.
// `obligatoria` marca las dos que forman el grupo "responsable O residente".
export const CL_FIRMA_ROLES: { value: ClFirmaRol; label: string; obligatoria: boolean }[] = [
  { value: 'maestro', label: 'Maestro (ejecutor) (opcional)', obligatoria: false },
  { value: 'residente', label: 'Ing. Residente', obligatoria: true },
  { value: 'responsable', label: 'Ing. Responsable', obligatoria: true },
  { value: 'cliente', label: 'Cliente (opcional)', obligatoria: false },
  { value: 'mivhed', label: 'MIVHED (opcional)', obligatoria: false },
];

/** Z3 — roles que, con UNO firmado, ya liberan (residente O responsable). */
export const CL_ROLES_LIBERAN: ClFirmaRol[] = ['residente', 'responsable'];

export interface ClItemRespuesta {
  etiqueta: string;
  seccion: string | null;
  cumple: boolean | null;
  comentario: string | null;
  orden: number;
}

export interface ClFotoCaptura {
  blob: Blob;
  correcto: boolean;
  descripcion: string | null;
  /** Q4 — URL local para la miniatura en el grid (el servicio la ignora). */
  previewUrl?: string;
}

export interface ClFirmaCaptura {
  rol: ClFirmaRol;
  nombre: string | null;
  blob: Blob;
  /** Q5 — 'pad' = trazo en pantalla; 'foto' = foto de la firma en papel. */
  metodo?: 'pad' | 'foto';
  /** Z2 — usuario ligado (responsable/residente del proyecto), si se eligió de la lista. */
  usuarioId?: string | null;
  /** Z3 — firma EN SUSTITUCIÓN de otro responsable (usuario + nombre legible). */
  enSustitucionDe?: string | null;
  enSustitucionDeNombre?: string | null;
}

// Q5 (3b) — firmar un CL existente desde el aviso / la bandeja.
export interface ClFirmaExistente {
  rol: string;
  nombre: string | null;
  metodo: string | null;
  firmado_en: string | null;
  /** S14 — URL firmada de la imagen de la firma (para el review). */
  firma_url?: string | null;
}

// S14 — ítem del CL para la revisión read-only antes de firmar.
export interface ClItemRevision {
  etiqueta: string;
  seccion: string | null;
  cumple: boolean | null;
  comentario: string | null;
}
// S14 — foto del CL (URL firmada) para la revisión.
export interface ClFotoRevision {
  url: string;
  correcto: boolean | null;
  descripcion: string | null;
}
export interface ClRegistroDetalle {
  id: string;
  estado: string; // 'borrador' | 'firmado'
  bloque: string | null;
  eje: string | null;
  observaciones: string | null;
  created_at: string;
  proyecto: string;
  plantilla: string;
  plantillaCodigo: string;
  firmas: ClFirmaExistente[];
  // S14 — revisión completa read-only.
  items: ClItemRevision[];
  fotos: ClFotoRevision[];
  planoUrl: string | null;
}
export interface ClPendiente {
  id: string;
  proyecto: string;
  plantilla: string;
  created_at: string;
  faltantes: string[];
}

export interface ClCaptura {
  proyectoId: string;
  proyecto: string;
  plantillaId: string;
  plantilla: string;
  bloque: string | null;
  eje: string | null;
  observaciones: string | null;
  items: ClItemRespuesta[];
  plano: Blob | null;
  fotos: ClFotoCaptura[];
  firmas: ClFirmaCaptura[];
}
