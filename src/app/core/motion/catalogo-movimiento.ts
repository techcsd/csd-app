/**
 * CL2/CL5 — REGISTRO ÚNICO de todo el movimiento de la app. Cada directiva, cada
 * celebración (`celebrar`) y cada momento (`momento`) tiene aquí una fila con su id.
 * Un script versionado (CL5, `scripts/data-fixes/…-cl5-movimiento-catalogo.mjs`) sube
 * ESTAS filas a `sgc.movimiento_catalogo`, y el submódulo **Administración › Animaciones**
 * de la web las lista con vista previa.
 *
 * Paridad web (regla 5): la forma de la fila ESPEJA la tabla `sgc.movimiento_catalogo`
 * (CONTEXTO-45 §E-2) — las columnas son las mismas (`id, sistema, nombre, nivel, donde,
 * pantallas[], duracion_ms, curva, reducido, desde_version, preview_key, estado`) para
 * que el upsert sea directo y app↔web compartan ids y tiempos. El registro gemelo de la
 * web vive en `SGC/src/shared/motion/catalogo-movimiento.ts` (pendiente, PROMPT-92).
 *
 * Prueba unitaria (`catalogo-movimiento.spec.ts`): todo id usado en la app (directiva,
 * celebración, momento, sistema) existe aquí, y toda fila de aquí se usa en algún lado.
 */

/** Sistema(s) donde vive la animación. Espeja `movimiento_catalogo.sistema`. */
export type MovimientoSistema = 'web' | 'app' | 'web-app';

/** Nivel de movimiento (CJ4). Espeja `movimiento_catalogo.nivel`. */
export type MovimientoNivel = 'sistema' | 'simple' | 'mediano' | 'grande';

/** Estado de adopción. Espeja `movimiento_catalogo.estado`. */
export type MovimientoEstado = 'en_uso' | 'pendiente';

/** Una fila del catálogo = una columna por columna de `sgc.movimiento_catalogo`. */
export interface MovimientoRegistro {
  /** id estable (también es el id que usa la directiva/celebración/momento). */
  id: string;
  sistema: MovimientoSistema;
  nombre: string;
  nivel: MovimientoNivel;
  /** Texto humano de "dónde sale". */
  donde: string;
  /** Pantallas donde aparece (rutas/carpetas). `text[]` en la tabla. */
  pantallas: string[];
  duracion_ms: number;
  /** Curva (nombre de token o cubic-bezier). */
  curva: string;
  /** Qué se ve con reduce-motion. */
  reducido: string;
  /** Versión desde la que existe (semver corto). */
  desde_version: string;
  /** Clave de vista previa que renderiza CL5. */
  preview_key: string;
  estado: MovimientoEstado;
}

const EASE_OUT = 'ease-out';
const EASE_IN = 'ease-in';

export const MOVIMIENTO_CATALOGO: MovimientoRegistro[] = [
  // ── Sistema (infra, no se dispara desde una pantalla) ──────────────────────
  {
    id: 'xfade',
    sistema: 'web-app',
    nombre: 'Cambio de pantalla',
    nivel: 'sistema',
    donde: 'Todas las navegaciones',
    pantallas: ['todas'],
    duracion_ms: 220,
    curva: EASE_OUT,
    reducido: 'sin movimiento',
    desde_version: 'app 2.45',
    preview_key: 'xfade',
    estado: 'en_uso',
  },
  {
    id: 'hoja',
    sistema: 'web-app',
    nombre: 'Hoja inferior / diálogo',
    nivel: 'sistema',
    donde: 'Hojas, confirmaciones, selectores',
    pantallas: ['global'],
    duracion_ms: 320,
    curva: EASE_OUT,
    reducido: 'sin movimiento',
    desde_version: 'app 2.47',
    preview_key: 'hoja',
    estado: 'en_uso',
  },

  // ── Base en todas las pantallas (directivas CL2) ───────────────────────────
  {
    id: 'lista',
    sistema: 'web-app',
    nombre: 'Lista escalonada',
    nivel: 'simple',
    donde: 'Listados y tablas (primera carga)',
    pantallas: ['global'],
    duracion_ms: 220,
    curva: EASE_OUT,
    reducido: 'sin movimiento',
    desde_version: 'app 2.47',
    preview_key: 'lista',
    estado: 'en_uso',
  },
  {
    id: 'kpi-countup',
    sistema: 'web-app',
    nombre: 'KPI que cuenta',
    nivel: 'simple',
    donde: 'Resúmenes y paneles con cifras',
    pantallas: ['global'],
    duracion_ms: 600,
    curva: EASE_OUT,
    reducido: 'valor final al instante',
    desde_version: 'app 2.47',
    preview_key: 'kpi-countup',
    estado: 'en_uso',
  },
  {
    id: 'skeleton-fade',
    sistema: 'web-app',
    nombre: 'Cargando → contenido',
    nivel: 'simple',
    donde: 'Al reemplazar el esqueleto por los datos',
    pantallas: ['global'],
    duracion_ms: 220,
    curva: EASE_OUT,
    reducido: 'aparece sin fundido',
    desde_version: 'app 2.47',
    preview_key: 'skeleton-fade',
    estado: 'en_uso',
  },
  {
    id: 'tab-indicator',
    sistema: 'web-app',
    nombre: 'Pestañas / filtros',
    nivel: 'simple',
    donde: 'Indicador de pestañas y segmentos',
    pantallas: ['global'],
    duracion_ms: 220,
    curva: EASE_OUT,
    reducido: 'se coloca sin deslizar',
    desde_version: 'app 2.47',
    preview_key: 'tab-indicator',
    estado: 'en_uso',
  },
  {
    id: 'estado-pulse',
    sistema: 'web-app',
    nombre: 'Cambio de estado',
    nivel: 'simple',
    donde: 'Chips de estado en tablas, tarjetas y fichas',
    pantallas: ['global'],
    duracion_ms: 320,
    curva: EASE_OUT,
    reducido: 'sin pulso',
    desde_version: 'app 2.47',
    preview_key: 'estado-pulse',
    estado: 'en_uso',
  },
  {
    id: 'wizard-step',
    sistema: 'web-app',
    nombre: 'Paso de formulario',
    nivel: 'simple',
    donde: 'Formularios por pasos (wizard)',
    pantallas: ['global'],
    duracion_ms: 220,
    curva: EASE_OUT,
    reducido: 'aparece sin subir',
    desde_version: 'app 2.47',
    preview_key: 'wizard-step',
    estado: 'en_uso',
  },
  {
    id: 'error-shake',
    sistema: 'web-app',
    nombre: 'Error que tiembla',
    nivel: 'simple',
    donde: 'Campo/paso con error de validación',
    pantallas: ['global'],
    duracion_ms: 220,
    curva: 'ease-in-out',
    reducido: 'sin temblor',
    desde_version: 'app 2.47',
    preview_key: 'error-shake',
    estado: 'en_uso',
  },
  {
    id: 'tap-scale',
    sistema: 'app',
    nombre: 'Tarjeta al tocar',
    nivel: 'simple',
    donde: 'Tarjetas clicables y botones grandes',
    pantallas: ['global'],
    duracion_ms: 150,
    curva: EASE_OUT,
    reducido: 'sin escala',
    desde_version: 'app 2.47',
    preview_key: 'tap-scale',
    estado: 'en_uso',
  },

  // ── Momentos medianos (0,8 s, sin velo — app-momento) ──────────────────────
  {
    id: 'entrada',
    sistema: 'web-app',
    nombre: 'Entrada registrada',
    nivel: 'mediano',
    donde: 'Recepción / entrada de inventario',
    pantallas: ['inventario/recibir', 'inventario/entrada'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'entrada',
    estado: 'pendiente',
  },
  {
    id: 'salida',
    sistema: 'web-app',
    nombre: 'Salida / despacho',
    nivel: 'mediano',
    donde: 'Salida, despacho, confirmar entrega',
    pantallas: ['inventario/salida', 'transporte/confirmaciones'],
    duracion_ms: 800,
    curva: EASE_IN,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'salida',
    estado: 'pendiente',
  },
  {
    id: 'aprobado',
    sistema: 'web-app',
    nombre: 'Aprobación',
    nivel: 'mediano',
    donde: 'Requisición/ausencia/firma aprobada, por aprobar',
    pantallas: ['solicitudes/detalle', 'transporte/por-aprobar'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el sello fijo',
    desde_version: 'app 2.47',
    preview_key: 'aprobado',
    estado: 'pendiente',
  },
  {
    id: 'firma',
    sistema: 'web-app',
    nombre: 'Firma registrada',
    nivel: 'mediano',
    donde: 'Firma de conduce / documento / contrato',
    pantallas: ['transporte/conduce-detalle', 'transporte/conduces-por-firmar'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el trazo fijo',
    desde_version: 'app 2.47',
    preview_key: 'firma',
    estado: 'pendiente',
  },
  {
    id: 'combustible',
    sistema: 'web-app',
    nombre: 'Combustible / echada',
    nivel: 'mediano',
    donde: 'Registrar combustible, echar combustible',
    pantallas: ['transporte/combustible', 'transporte/combustible-log'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'combustible',
    estado: 'pendiente',
  },
  {
    id: 'checklist',
    sistema: 'web-app',
    nombre: 'Checklist / inspección',
    nivel: 'mediano',
    donde: 'Checklist, inspección de vehículo, conteo cerrado',
    pantallas: ['transporte/checklist', 'transporte/preuso', 'inventario/conteo'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'checklist',
    estado: 'pendiente',
  },
  {
    id: 'mantenimiento',
    sistema: 'web-app',
    nombre: 'Mantenimiento cerrado',
    nivel: 'mediano',
    donde: 'Cierre de mantenimiento',
    pantallas: ['transporte/mantenimiento-cierre'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'mantenimiento',
    estado: 'pendiente',
  },
  {
    id: 'mensaje',
    sistema: 'web-app',
    nombre: 'Mensaje / nota enviada',
    nivel: 'mediano',
    donde: 'Mensajes, notas (compartir)',
    pantallas: ['mensajes', 'notas'],
    duracion_ms: 800,
    curva: EASE_IN,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'mensaje',
    estado: 'pendiente',
  },
  {
    id: 'documento',
    sistema: 'web-app',
    nombre: 'Documento generado',
    nivel: 'mediano',
    donde: 'Documento generado / plantilla guardada / PDF',
    pantallas: ['transporte/conduce-detalle'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'documento',
    estado: 'pendiente',
  },
  {
    id: 'uso',
    sistema: 'app',
    nombre: 'Uso de vehículo',
    nivel: 'mediano',
    donde: 'Tomar / soltar vehículo (la llave pasa de mano)',
    pantallas: ['transporte/uso-vehiculo'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'uso',
    estado: 'pendiente',
  },
  {
    id: 'todo-enviado',
    sistema: 'app',
    nombre: 'Todo enviado',
    nivel: 'mediano',
    donde: 'Al vaciar la cola offline (outbox)',
    pantallas: ['global'],
    duracion_ms: 800,
    curva: EASE_OUT,
    reducido: 'solo el check',
    desde_version: 'app 2.47',
    preview_key: 'todo-enviado',
    estado: 'pendiente',
  },

  // ── Celebraciones grandes (overlay app-celebracion — CJ2/CJ3) ──────────────
  {
    id: 'conduce',
    sistema: 'web-app',
    nombre: 'Conduce creado',
    nivel: 'grande',
    donde: 'Generar conduce, conduce externo',
    pantallas: ['transporte/generar-conduce', 'transporte/conduce-externo'],
    duracion_ms: 1600,
    curva: EASE_OUT,
    reducido: 'solo el check + mensaje',
    desde_version: 'app 2.45',
    preview_key: 'conduce',
    estado: 'en_uso',
  },
  {
    id: 'ruta',
    sistema: 'app',
    nombre: 'Ruta creada',
    nivel: 'grande',
    donde: 'Crear ruta',
    pantallas: ['transporte/rutas'],
    duracion_ms: 1350,
    curva: 'cubic-bezier(0.45, 0.05, 0.4, 1)',
    reducido: 'solo el check + mensaje',
    desde_version: 'app 2.45',
    preview_key: 'ruta',
    estado: 'en_uso',
  },
];

/** Todos los ids del catálogo (para la prueba unitaria y upserts). */
export const MOVIMIENTO_IDS = MOVIMIENTO_CATALOGO.map((r) => r.id);

/** Busca una fila por id. */
export function registroMovimiento(id: string): MovimientoRegistro | undefined {
  return MOVIMIENTO_CATALOGO.find((r) => r.id === id);
}
