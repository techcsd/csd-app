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
}

/** Respuesta de un turno de chat de la edge `assistant`. */
export interface CompaRespuesta {
  conversacion_id: string | null;
  respuesta: string;
  herramientas: CompaHerramienta[];
  propuesta: Propuesta | null;
}

/** Un mensaje pintado en el hilo del asistente (en memoria por sesión). */
export interface CompaMensaje {
  id: string;
  rol: 'user' | 'assistant';
  texto: string;
  propuesta?: Propuesta | null;
  /** true mientras el turno del usuario espera respuesta (indicador local). */
  enviando?: boolean;
}
