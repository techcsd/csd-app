/**
 * Z30 — Contenido de ayuda ("Dudas" + "Guías visuales"), consumido desde la BD
 * compartida `sgc.ayuda_contenido` (misma fuente que la web, sin duplicar a
 * mano). Los shapes espejan `dudas-content.ts` de SGC.
 */

export interface DudaItem {
  pregunta: string;
  respuesta: string;
}

export interface DudaCategoria {
  id: string;
  titulo: string;
  /** Si está, solo la ven usuarios con ese módulo (admin ve todo). */
  modulo?: string;
  /** Si true, solo admin. */
  soloAdmin?: boolean;
  items: DudaItem[];
}

export interface GuiaVisual {
  id: string;
  titulo: string;
  /** Clave corta de icono (la plantilla la mapea a un emoji). */
  icono: 'preuso' | 'combustible' | 'conduce' | 'bitacora' | 'inventario';
  modulo?: string;
  pasos: string[];
}
