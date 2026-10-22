/**
 * FASE 4 "Compa" — tipos del asistente de IA. Reutiliza la edge `assistant`
 * (ya desplegada). El asistente hereda los permisos del usuario server-side
 * (JWT adjunto por supabase-js); el móvil NUNCA ejecuta la acción, solo la
 * confirma.
 */

/** Herramienta usada por el asistente en un turno (para trazabilidad/depuración). */
export interface CompaHerramienta {
  tool: string;
  ok: boolean;
}

/**
 * Propuesta de acción de ESCRITURA preparada por el asistente (v2). La UI muestra
 * `titulo` + `lineas` en una hoja de confirmación; al confirmar, se reenvía el
 * objeto VERBATIM en `{ ejecutar }`. `tipo`/`tool`/`params` son opacos para el
 * cliente (los interpreta la edge).
 */
export interface Propuesta {
  tipo: string;
  tool: string;
  params: Record<string, unknown>;
  titulo: string;
  lineas: string[];
  /**
   * CV1 — presente SOLO en propuestas "preparar + abrir" (p.ej. `preparar_echada`).
   * La hoja no ofrece "Confirmar"/`ejecutar`: un solo botón "Abrir formulario" que
   * navega con `destino.query` como queryParams. Compa nunca guarda ni sube fotos.
   */
  accion?: 'abrir';
  /** CV1 — a dónde navegar y con qué queryParams cuando `accion === 'abrir'`. */
  destino?: { vehiculo_id: string; query: Record<string, string | number> };
  /** CV1 — lo que falta para completar (p.ej. ['Foto del recibo', 'Foto del tablero', 'Lectura del odómetro']). */
  faltan?: string[];
}

/** CP3 — un archivo generado por el asistente (PDF u otro) adjunto a la respuesta. */
export interface CompaArchivo {
  nombre: string;
  url: string;
}

/** Respuesta de un turno de chat de la edge `assistant`. */
export interface CompaRespuesta {
  conversacion_id: string | null;
  respuesta: string;
  herramientas: CompaHerramienta[];
  propuesta: Propuesta | null;
  /** CP3 — varios archivos por turno (antes: uno solo, ver `archivo` en el edge). */
  archivos: CompaArchivo[];
}

/** CP2 — una conversación que alguien compartió conmigo (`compa_compartidas_conmigo`). */
export interface CompaCompartida {
  id: string;
  conversacion_id: string;
  titulo: string | null;
  compartida_por_nombre: string | null;
  mensaje: string | null;
  created_at: string;
  vista_at: string | null;
}

/** CP2 — un mensaje de una conversación compartida (solo lectura, `compa_conversacion_compartida`). */
export interface CompaMensajeCompartido {
  mensaje_id: string;
  rol: 'user' | 'assistant';
  contenido: string;
  herramientas: CompaHerramienta[] | null;
  created_at: string;
}

/** Un mensaje pintado en el hilo del asistente (en memoria por sesión). */
export interface CompaMensaje {
  id: string;
  rol: 'user' | 'assistant';
  texto: string;
  propuesta?: Propuesta | null;
  /** true mientras el turno del usuario espera respuesta (indicador local). */
  enviando?: boolean;
  /** BB2/AY11a — instante del mensaje (ISO) para pintar la hora al pie de la burbuja. */
  ts?: string;
  /** CP3 — archivos devueltos por el asistente en este turno (PDFs, etc.). */
  archivos?: CompaArchivo[];
}
