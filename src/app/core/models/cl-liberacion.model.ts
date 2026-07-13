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

// Ciclo de firmas del procedimiento (los 3 obligatorios habilitan el vaciado).
export type ClFirmaRol = 'maestro' | 'residente' | 'responsable' | 'cliente' | 'mivhed';

export const CL_FIRMA_ROLES: { value: ClFirmaRol; label: string; obligatoria: boolean }[] = [
  { value: 'maestro', label: 'Maestro (ejecutor)', obligatoria: false },
  { value: 'residente', label: 'Ing. Residente', obligatoria: true },
  { value: 'responsable', label: 'Ing. Responsable', obligatoria: true },
  { value: 'cliente', label: 'Cliente', obligatoria: true },
  { value: 'mivhed', label: 'MIVHED', obligatoria: false },
];

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
}

export interface ClFirmaCaptura {
  rol: ClFirmaRol;
  nombre: string | null;
  blob: Blob;
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
