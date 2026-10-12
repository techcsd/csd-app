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

  // ── CK5 — Video tutorial OPCIONAL (PROMPT-91 F6) ───────────────────────────
  // El padre graba y sube el video al bucket PRIVADO `tutoriales`; mientras no
  // exista, estos campos vienen vacíos y el player NO se pinta (patrón de
  // capacidad: no-op hasta que llega la data). `video_path` se firma al vuelo
  // (signed URL 1h); los pasos de texto siguen disponibles offline sin video.
  // Se aceptan alias por si el padre nombra distinto el campo en `contenido`.
  /** Ruta del video en el bucket `tutoriales` (se firma al reproducir). */
  video_path?: string;
  /** Alias de `video_path`. */
  video?: string;
  /** Póster: ruta de bucket (se firma) o URL http(s) (se usa tal cual). */
  poster?: string;
  /** Alias de `poster`. */
  poster_path?: string;
  /** Subtítulos .vtt: ruta en el bucket `tutoriales` (se firma). */
  subtitulos?: string;
  /** Alias de `subtitulos`. */
  subtitulos_path?: string;
  /** Duración legible ("2:30") o segundos (number) para la etiqueta. */
  duracion?: string | number;
  /** Bandera opcional del padre (no requerida: basta con `video_path`). */
  con_video?: boolean;

  // ── CM3 (PROMPT-95 F5) — upgrade del reproductor ───────────────────────────
  // Campos OPCIONALES que el padre rellena al subir los videos v2. Si faltan, el
  // player sigue funcionando (sin capítulos, sin kicker): patrón de capacidad.
  /** Antetítulo corto del video ("CSD APP · FLOTA"). Solo estético. */
  kicker?: string;
  /**
   * Capítulos para la hoja inferior: tiempo (segundos o "m:ss") + etiqueta.
   * Tocar un capítulo salta el `<video>` a ese segundo.
   */
  capitulos?: { t: number | string; label: string }[];
  /**
   * CM1 — si está presente, es uno de los 2 VIDEOS DE INSTALACIÓN: se muestra
   * arriba en "Primeros pasos" con "Compartir por WhatsApp" y NO se gatea por
   * módulo (lo ve todo usuario). El valor dice para qué público es.
   */
  instalacion?: 'android' | 'iphone';
  /**
   * CM1 — enlace PÚBLICO (versión vertical) para "Compartir por WhatsApp". Si el
   * padre no lo pone, se comparte el enlace de la app. Nunca se comparte el signed
   * URL del bucket privado (expira en 1h).
   */
  compartir_url?: string;
}

/** CK5 — URLs firmadas de un video de guía, listas para el elemento `<video>`. */
export interface GuiaVideoFirmado {
  url: string;
  poster: string | null;
  subtitulos: string | null;
  duracion: string | null;
  /** CM3 — título/antetítulo para la portada del reproductor a pantalla completa. */
  titulo?: string;
  kicker?: string;
  /** CM3 — capítulos normalizados a segundos (etiqueta + segundo de salto). */
  capitulos?: { segundo: number; label: string }[];
}
