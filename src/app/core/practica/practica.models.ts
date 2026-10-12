/**
 * CM7 (PROMPT-95 F6) — modo práctica: tipos del simulador local.
 *
 * El modo práctica NO toca datos reales: las misiones son escenarios locales
 * (bundled), las "escrituras" y "fotos" viven en memoria y lo ÚNICO que sale a la
 * red es `practica_guardar_intento` (la nota). Push/GPS/tracking no se activan.
 */

/** Un objetivo visible que el usuario va marcando en vivo (chips arriba). */
export interface PracticaObjetivo {
  id: string;
  label: string;
}

/** Tipo de paso del guion de una misión. */
export type PasoTipo = 'valor' | 'foto' | 'accion' | 'confirmar';

/** Un paso del guion de la misión (una acción del usuario). */
export interface PracticaPaso {
  id: string;
  tipo: PasoTipo;
  /** Etiqueta del botón de avance para este paso ("Tomar foto del recibo"…). */
  cta: string;
  /** Campo (para `tipo='valor'`): etiqueta + objetivo que completa. */
  campo?: {
    label: string;
    /** Objetivo que se marca al completar este paso. */
    objetivo: string;
    /** Valor "correcto" que se autollena al avanzar (demo). */
    valor: string;
    /**
     * Si está, el paso tiene una TRAMPA: el primer intento mete `valorMalo`
     * (dispara el error + penalización) y el usuario debe "corregir" (avanzar otra
     * vez) para poner el valor bueno. Copia del mock (km menor al anterior).
     */
    trampa?: { valorMalo: string; mensaje: string; penalizacionId: string };
  };
  /** Para `tipo='foto'`: etiqueta del slot + objetivo que completa. */
  foto?: { label: string; objetivo: string };
  /** Para `tipo='accion'`: una acción simulada (firmar, marcar estado, elegir…). */
  accion?: { label: string; objetivo: string };
}

/** Una regla de puntos (positiva) o penalización (negativa). */
export interface PracticaRegla {
  id: string;
  /** Texto para la lista ✓/✗ del resultado. */
  label: string;
  /** Puntos (positivos suman, negativos restan). */
  puntos: number;
}

/** Definición completa de una misión de práctica (escenario local). */
export interface PracticaMision {
  /** id estable (coincide con `practica_misiones.id`, p. ej. 'app-combustible'). */
  id: string;
  titulo: string;
  sub: string;
  /** Roles que la ven (vacío = todos). Espeja `practica_misiones.roles`. */
  roles: string[];
  /** version del escenario (para `practica_guardar_intento`). */
  version: number;
  objetivos: PracticaObjetivo[];
  pasos: PracticaPaso[];
  /** Reglas de puntos (se otorgan si se cumplen; ver `evaluar`). */
  reglas: {
    /**
     * Puntos positivos. Cada regla se gana si TODOS sus `objetivos` quedaron hechos
     * (o siempre, si no lista objetivos). Así cada misión reparte sus puntos.
     */
    puntos: Array<PracticaRegla & { objetivos?: string[] }>;
    /** Bono por terminar bajo `tiempoBonoSegundos`. */
    tiempo?: PracticaRegla & { tiempoBonoSegundos: number };
    /** Penalizaciones posibles (por id, disparadas por trampas). */
    penalizaciones: PracticaRegla[];
  };
  /** Nota mínima para aprobar (0-100). */
  aprobarDesde: number;
}

/** Una línea del desglose ✓/✗ del resultado. */
export interface PracticaResultadoLinea {
  ok: boolean;
  label: string;
  puntos: number;
}

/** Resultado calculado de un intento. */
export interface PracticaResultado {
  nota: number;
  estrellas: number;
  aprobada: boolean;
  duracionS: number;
  lineas: PracticaResultadoLinea[];
}

/** Una fila de "Mis resultados" (RPC `practica_resultados_persona`). */
export interface PracticaIntentoFila {
  id: string;
  mision_id: string;
  version: number;
  nota: number;
  estrellas: number;
  aprobada: boolean;
  duracion_s: number | null;
  created_at: string;
}
