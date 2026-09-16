/**
 * BO10 — Cartillas de acero (rebar sheets). Guilamo captura en el teléfono los
 * atados de acero (cada atado con sus piezas: marca, diámetro, figura, tramos,
 * cantidad); Ramón/oficina las revisa en la web. Offline-first por outbox.
 *
 * Contrato del padre (SGC, desplegado):
 *   crear_cartilla(p_id, p_proyecto_id, p_fecha, p_atados jsonb, p_fotos jsonb,
 *                  p_plano_path, p_notas) — idempotente por p_id.
 *   cartilla_detalle / cartillas_listado / cartillas_resumen_acero /
 *   cartilla_cambiar_estado.
 */

/** Catálogo `sgc.acero_diametros` (abierto a lectura). */
export interface AceroDiametro {
  codigo: string; // '3/8"', '1/2"', '5/8"', '3/4"', '1"'
  mm: number;
  kg_por_m: number;
  activo: boolean;
}

/** Catálogo `sgc.cartilla_figuras` (abierto a lectura). El SVG del catálogo puede
 *  venir nulo → se dibuja por `codigo` con `app-figura-acero`. */
export interface CartillaFigura {
  codigo: string; // recta | l | u | estribo | gancho | z
  nombre: string;
  svg: string | null;
  activo: boolean;
}

/** Un tramo de una pieza (un lado de la figura), en cm. */
export interface CartillaTramo {
  lado?: string; // 'A', 'B', 'C'…
  cm: number;
}

/** Una pieza de acero dentro de un atado (captura). */
export interface CartillaPiezaCaptura {
  marca: string;
  diametro_codigo: string;
  figura_codigo: string;
  tramos_cm: CartillaTramo[];
  cantidad: number;
}

/** Un atado de acero (captura). */
export interface CartillaAtadoCaptura {
  identificador: string;
  elemento: string; // estructura/elemento (zapata, viga, columna…)
  cantidad_piezas: number;
  piezas: CartillaPiezaCaptura[];
}

/** Lo que la pantalla arma antes de encolar. */
export interface CartillaCaptura {
  proyectoId: string;
  fecha: string; // YYYY-MM-DD (BL9, elegible)
  atados: CartillaAtadoCaptura[];
  notas: string | null;
  fotos: Blob[]; // fotos de la cartilla física (≥1)
  plano?: Blob | null; // plano de referencia (opcional)
  esPrueba?: boolean;
}

export type CartillaEstado = 'borrador' | 'enviada' | 'revisada' | 'observada' | 'ejecutada';

/** Fila del listado "Mis cartillas". */
export interface CartillaListado {
  id: string;
  folio: string;
  proyecto_nombre: string | null;
  fecha: string;
  estado: CartillaEstado;
  peso_total_kg: number | null;
  atados: number | null;
  es_prueba?: boolean;
}

/** Pieza tal como la sirve el detalle. */
export interface CartillaPiezaDetalle {
  id: string;
  marca: string | null;
  diametro_codigo: string;
  figura_codigo: string;
  tramos_cm: CartillaTramo[] | null;
  longitud_total_cm: number | null;
  cantidad: number;
  peso_kg: number | null;
}

export interface CartillaAtadoDetalle {
  id: string;
  identificador: string | null;
  elemento: string | null;
  cantidad_piezas: number | null;
  orden: number;
  piezas: CartillaPiezaDetalle[];
}

export interface CartillaEvento {
  estado_desde: string | null;
  estado_hasta: string;
  usuario_nombre?: string | null;
  nota: string | null;
  created_at: string;
}

export interface CartillaDetalle {
  id: string;
  folio: string;
  proyecto_id: string;
  proyecto_nombre?: string | null;
  ingeniero_nombre?: string | null;
  fecha: string;
  estado: CartillaEstado;
  observacion: string | null;
  notas: string | null;
  plano_path: string | null;
  peso_total_kg: number | null;
  atados: CartillaAtadoDetalle[];
  fotos: string[];
  eventos?: CartillaEvento[];
  es_prueba?: boolean;
}
