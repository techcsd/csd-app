// AU15 — Diccionario CENTRAL de etiquetas para los enums del dominio (ESPEJO del
// contrato de la web: SGC `src/shared/utils/dominio-labels.util.ts`). Un solo lugar
// donde `uso_proyecto` → "Uso en proyecto", `en_ruta` → "En ruta", etc., para que el
// MISMO valor se lea igual en toda la app y en la web.
//
// Regla AU15: ninguna pantalla muestra un valor crudo (snake_case / MAYÚSCULAS). Si un
// valor no está mapeado, `humanizarEnum` lo vuelve legible como red de seguridad.
// NO agregar `if` de etiquetas sueltos en las pantallas: agregarlos aquí.

/** Estado de un conduce/salida. */
export const CONDUCE_ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  despachado: 'Despachado',
  en_ruta: 'En ruta',
  en_transito: 'En tránsito',
  pendiente_firma: 'Pendiente de firma',
  por_confirmar: 'Por confirmar',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado (incompleto)',
  confirmado: 'Confirmado',
  cerrado: 'Cerrado',
  anulado: 'Eliminado',
};

/** Motivo (uso) de una salida/conduce. */
export const CONDUCE_MOTIVO_LABELS: Record<string, string> = {
  uso_proyecto: 'Uso en proyecto',
  uso_en_proyecto: 'Uso en proyecto',
  traslado_almacen: 'Traslado a almacén (Bodega Central)',
  traspaso: 'Traspaso entre almacenes',
  venta: 'Venta',
  merma: 'Merma / Pérdida',
  devolucion: 'Devolución a proveedor',
  devolucion_suplidor: 'Devolución a suplidor',
  devolucion_obra: 'Devolución de obra',
  compra: 'Compra / entrada',
  entrada: 'Entrada',
  reparacion: 'Reparación',
  prestamo: 'Préstamo',
  ajuste: 'Ajuste',
  otro: 'Otro',
};

/** Fase del conduce (derivada server-side). */
export const CONDUCE_FASE_LABELS: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En ruta',
  en_ruta: 'En ruta',
  entregando: 'Entregando',
  por_confirmar: 'Por confirmar',
  pendiente_firma: 'Pendiente de firma',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado (incompleto)',
  confirmado: 'Confirmado',
  cerrado: 'Cerrado',
};

/** Estado del chofer (paridad con Seguimiento). */
export const CHOFER_ESTADO_LABELS: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  descanso: 'Descanso',
  almuerzo: 'Almuerzo',
  inactivo: 'Inactivo',
  otros: 'Otros',
};

/** Estado de una ruta de transporte. */
export const RUTA_ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_ruta: 'En ruta',
  iniciada: 'Iniciada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  modificada: 'Modificada',
};

/** Tipo de movimiento de inventario (ledger). */
export const MOVIMIENTO_TIPO_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  apertura: 'Apertura',
  devolucion: 'Devolución',
  traslado: 'Traslado',
};

/**
 * Red de seguridad: convierte cualquier valor crudo de enum (`snake_case`, `MAYÚSCULAS`,
 * `kebab-case`) en texto legible. Se usa cuando no hay un mapa específico, para que NUNCA
 * se muestre un valor técnico en la UI (regla AU15).
 */
export function humanizarEnum(valor: string | null | undefined): string {
  if (valor == null) return '';
  const s = String(valor).trim();
  if (!s) return '';
  const limpio = s.replace(/[_-]+/g, ' ').toLowerCase().trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Mapas registrados por "grupo" del dominio, para el helper genérico `traducir`. */
const GRUPOS: Record<string, Record<string, string>> = {
  conduce_estado: CONDUCE_ESTADO_LABELS,
  conduce_motivo: CONDUCE_MOTIVO_LABELS,
  conduce_fase: CONDUCE_FASE_LABELS,
  chofer_estado: CHOFER_ESTADO_LABELS,
  ruta_estado: RUTA_ESTADO_LABELS,
  movimiento_tipo: MOVIMIENTO_TIPO_LABELS,
};

export type DominioGrupo = keyof typeof GRUPOS;

/**
 * Traduce un valor de enum a su etiqueta en español usando el mapa del grupo indicado;
 * si el valor no está en el mapa, cae a `humanizarEnum` (nunca devuelve el valor crudo).
 */
export function traducir(grupo: DominioGrupo, valor: string | null | undefined): string {
  if (valor == null || valor === '') return '';
  return GRUPOS[grupo]?.[valor] ?? humanizarEnum(valor);
}
