import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { LocalStore } from './local-store.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';
import { AyudanteService } from './ayudante.service';
import { Conduce, RutaHoy } from '../models/transporte.model';
import { Proyecto } from '../models/bitacora.model';
import { ItemLibre } from '../models/inventario.model';

const CATALOG_CONDUCES = 'mis_conduces';
const CATALOG_RUTAS = 'mis_rutas';
const CATALOG_PROYECTOS = 'proyectos';
// QA-6 — claves de caché read-through para que "Pendiente entrega" y "Por
// confirmar" sobrevivan offline (última foto del servidor).
const CATALOG_PENDIENTES_ENTREGA = 'mis_conduces_pendientes_entrega';
const CATALOG_POR_CONFIRMAR = 'mis_entregas_por_confirmar';
/** Y3 — ids de rutas planificadas ya vistas (para el badge de "rutas nuevas"). */
const VISTAS_KEY = 'conduces_rutas_vistas';

/** AD6 — tipo de ruta (aditivo). Personal/traslado no exigen carga. */
export type RutaTipo = 'material' | 'personal' | 'traslado';

/** New-route capture the crear-ruta wizard hands to crearRuta(). */
export interface RutaCaptura {
  vehiculoId: string;
  /** S16 — conductor asignado (el jefe de flota lo elige; dispara la notificación). */
  conductorId: string | null;
  /** AD6 — tipo de ruta (solo lo fija el chofer al crearse la suya). */
  tipo?: RutaTipo;
  origen: string;
  destino: string;
  fecha: string;
  destinoProyectoId: string | null;
  kmEstimado: number | null;
  notas: string | null;
  origen_lat: number | null;
  origen_lng: number | null;
  destino_lat: number | null;
  destino_lng: number | null;
  /** Z23 — notas de voz múltiples (opcional). */
  voces?: Blob[];
  // AC13 — paradas intermedias ordenadas (estilo Uber), opcional. El destino
  // sigue en la ruta (retrocompatible); estas son las paradas antes del destino.
  paradas?: RutaParadaCaptura[];
  // AC6 — fotos de evidencia inicial al crear la ruta (carga/vehículo/documento).
  fotos?: Blob[];
  /** AG15 — si la ruta nace de una tarea vinculada, su id (se enlaza al crear). */
  tareaVinculada?: string | null;
  /** AY11 — si la ruta se crea PLANIFICANDO una solicitud de movimiento, su id
   *  (al crear la ruta se vincula → la solicitud pasa a 'planificada'). */
  solicitudId?: string | null;
  /** AT4 — usuario_id del ayudante (opcional); le suma la ruta al incentivo. */
  ayudanteId?: string | null;
  /**
   * AV11 — id ESTABLE de la ruta, generado una vez en el wizard y reutilizado al
   * reanudar tras el checklist de uso. Garantiza idempotencia por p_id: un doble
   * envío (o el flujo checklist→reanudar) reusa el mismo id y el server devuelve
   * la ruta existente en vez de duplicar. Si no se pasa, se genera uno nuevo.
   */
  id?: string;
}

/** AE — el chofer GENERA un conduce (salida de material) desde una bodega hacia
 *  una obra. Valida stock en el servidor (crear_conduce_transportista). */
export interface ConduceTransportistaCaptura {
  /** null = origen "Otros" (movimiento sin almacén de stock). */
  bodegaId: string | null;
  proyectoId: string | null;
  observaciones: string | null;
  items: { articulo_id: string; cantidad: number }[];
  /** AF23.4 — al pasar vehículo + obra, el servidor auto-genera la ruta al emitir. */
  vehiculoId?: string | null;
  rutaId?: string | null;
  /** AF23.3 — firma de quien ENTREGA (emisor), obligatoria al emitir. */
  firmaEmisor?: Blob | null;
  emisorNombre?: string | null;
  /** AH4 — firma del chofer que TRANSPORTA (transportista), obligatoria al emitir.
   *  Si es la misma persona que entrega, se pasa la MISMA imagen que firmaEmisor
   *  (una sola firma con doble rol). */
  firmaTransportista?: Blob | null;
  transportistaNombre?: string | null;
  /** AH4 — true si quien entrega es OTRA persona (no el chofer logueado): su firma
   *  de emisor NO se atribuye al usuario actual. */
  emisorEsOtro?: boolean;
  /** AG15 — si el conduce nace de una tarea vinculada, su id (se enlaza al emitir). */
  tareaVinculada?: string | null;
}

/**
 * AI2 — conduce simplificado (sketch de Eduardo): origen → destino → materiales →
 * foto de recepción (el chofer carga del despachante) → despachante → firmas
 * (chofer + despachante) → "Pendiente entrega". Un solo RPC `crear_conduce_simple`
 * sella ambas firmas server-side. Offline-safe por outbox.
 */
export interface ConduceSimpleCaptura {
  /** null = origen "Otros" (movimiento sin almacén de stock). */
  bodegaId: string | null;
  proyectoId: string | null;
  /** AL10 — destino = almacén central (Bodega Central). Excluyente con proyectoId. */
  destinoAlmacenId?: string | null;
  observaciones: string | null;
  items: { articulo_id: string; cantidad: number }[];
  vehiculoId?: string | null;
  /** Despachante: usuario/empleado del origen, o nombre libre (ferretería/otros). */
  despachanteUsuarioId?: string | null;
  despachanteEmpleadoId?: string | null;
  despachanteNombre?: string | null;
  /** Foto de recepción (el chofer carga el material del despachante) — solo cámara. */
  fotoRecepcion?: Blob | null;
  /** Firmas de emisión: chofer (transportista) + despachante (emisor). */
  firmaChofer?: Blob | null;
  firmaDespachante?: Blob | null;
  tareaVinculada?: string | null;
  /** AU4 — materiales NO catalogados (nota libre); viajan en el conduce sin tocar stock. */
  itemsLibres?: ItemLibre[];
  /** AT4 — usuario_id del ayudante (opcional); le suma el conduce al incentivo. */
  ayudanteId?: string | null;
  /** AT16 — receptor elegido (usuario del sistema) al que se dirige la confirmación. */
  receptorUsuarioId?: string | null;
  receptorNombre?: string | null;
  /** BA/FASE 2 — despacho de una requisición: enlaza el conduce a la requisición. */
  origenRequisicionId?: string | null;
}

/** BA/Transporte v3 (FASE 2) — requisición lista para despachar. */
export interface RequisicionPorDespachar {
  id: string;
  proyecto_id: string;
  proyecto_nombre: string | null;
  solicitante: string | null;
  fecha: string;
  renglones: number;
  created_at: string;
}

/** BA/Transporte v3 (FASE 2) — avance de una requisición, renglón por renglón. */
export interface RenglonAvance {
  articulo_id: string | null;
  descripcion: string;
  unidad: string | null;
  talla: string | null;
  solicitado: number;
  despachado: number;
  pendiente: number;
}

/** BA/Transporte v3 — proveedor de transportación (catálogo + alta al vuelo). */
export interface ProveedorTransporte {
  id: string;
  nombre: string;
  telefono: string | null;
  estado: string; // 'sin_ratificar' | 'ratificado'
  es_prueba: boolean;
  viajes_total?: number;
  viajes_pendientes_pago?: number;
}

/** BA/Transporte v3 — una parte (origen/destino) del conduce externo, ya normalizada. */
export interface ConduceExternoLugar {
  nombre: string | null;
  lat: number | null;
  lng: number | null;
  proyecto_id: string | null;
  bodega_id: string | null;
}

/** BA/Transporte v3 (FASE 1) — captura del conduce externo (proveedor transporta). */
export interface ConduceExternoCaptura {
  transportaProveedorId: string | null;
  transportaTexto: string | null;
  /** Foto de la placa del camión — OBLIGATORIA. */
  placaFoto: Blob;
  /** Foto de la carga (opcional; puede ir en la misma toma de la placa). */
  cargaFoto: Blob | null;
  materialDescripcion: string | null;
  /** Items del catálogo (afectan inventario si tocan un almacén nuestro); null si carga libre. */
  items: { articulo_id: string; cantidad: number }[] | null;
  origen: ConduceExternoLugar | null;
  destino: ConduceExternoLugar | null;
  /** BA/FASE 2 — despacho de una requisición vía conduce externo (opcional). */
  origenRequisicionId?: string | null;
}

/**
 * AM1 — devolución a suplidor ("devolver a ferretería"): el ORIGEN (bodega) es
 * obligatorio y nombrado — sin destino de obra/almacén. Cierra el bug del
 * bodega_id null (crear_conduce_devolucion_suplidor lo exige server-side).
 */
export interface ConduceDevolucionSuplidorCaptura {
  /** ORIGEN obligatorio: almacén del que sale la mercancía. */
  bodegaOrigenId: string;
  /** Obra de la que sale (opcional; ayuda a resolver la bodega server-side). */
  proyectoOrigenId?: string | null;
  /** Nombre del suplidor al que se devuelve (va en observaciones estructuradas). */
  suplidorNombre: string;
  observaciones: string | null;
  items: { articulo_id: string; cantidad: number }[];
  vehiculoId?: string | null;
  despachanteUsuarioId?: string | null;
  despachanteEmpleadoId?: string | null;
  despachanteNombre?: string | null;
  fotoRecepcion?: Blob | null;
  firmaChofer?: Blob | null;
  firmaDespachante?: Blob | null;
  /** AU4 — materiales NO catalogados (nota libre); viajan en el conduce sin tocar stock. */
  itemsLibres?: ItemLibre[];
  /** AT4 — usuario_id del ayudante (opcional); le suma el conduce al incentivo. */
  ayudanteId?: string | null;
}

/** AT16 — un receptor elegible del conduce (matriz de autorizados de la obra). */
export interface ReceptorDisponible {
  id: string;
  nombre: string;
  detalle: string;
  /** true si está vinculado formalmente a la obra (vs. rol elevado global). */
  vinculado: boolean;
}

/** AH5 — una oferta de transferencia de responsabilidad de un conduce (inbox). */
export interface ConduceTransferencia {
  id: string;
  salida_id: string;
  estado: 'ofrecida' | 'aceptada' | 'rechazada' | 'cancelada';
  ofrecida_en: string;
  de_conductor_id: string | null;
  de_nombre: string | null;
  notas: string | null;
  conduce_fecha: string | null;
  conduce_obra: string | null;
  conduce_bodega: string | null;
  conduce_estado: string | null;
  items_count: number;
}

/** AH5 — una entrada del historial de transferencias de un conduce. */
export interface ConduceTransferenciaHist {
  id: string;
  estado: string;
  ofrecida_en: string;
  resuelta_en: string | null;
  de_conductor_id: string | null;
  de_nombre: string | null;
  a_conductor_id: string | null;
  a_nombre: string | null;
  notas: string | null;
}

/** AC13 — una parada intermedia de la ruta. */
export interface RutaParadaCaptura {
  ubicacion: string;
  lat: number | null;
  lng: number | null;
  notas: string | null;
  proyectoId: string | null;
}

/** AC13/AC6 — detalle de ruta para mostrar en el app (paradas + fotos). */
export interface RutaDetalleApp {
  paradas: { orden: number; ubicacion: string; notas: string | null }[];
  fotos: string[]; // URLs firmadas
}

/** AE5 — una parada de la ruta EN EJECUCIÓN: estado + evidencia + conduce vinculado. */
export type ParadaEstado = 'pendiente' | 'en_camino' | 'entregada' | 'omitida';
export interface RutaParadaEjec {
  id: string;
  orden: number;
  ubicacion: string;
  lat: number | null;
  lng: number | null;
  notas: string | null;
  obra: string | null;
  proyecto_id: string | null;
  estado: ParadaEstado;
  llegada_at: string | null;
  entregada_at: string | null;
  entregado_a: string | null;
  /** id del conduce (salida) vinculado a esta parada, si lo hay. */
  conduce_id: string | null;
}

/** AE5 — conduce vinculado a una ruta (nivel ruta o parada), para el detalle. */
export interface RutaConduceEjec {
  id: string;
  fecha: string;
  estado: string;
  destino: string | null;
  bodega: string | null;
  ruta_parada_id: string | null;
  parada_ubicacion: string | null;
  items: { articulo: string; unidad: string; cantidad: number }[];
}

/** AI3 — cabecera informativa de una ruta (H.I/H.F, duración, km). */
export interface RutaCabecera {
  id: string;
  origen: string | null;
  destino: string | null;
  estado: string;
  tipo: string | null;
  fecha: string | null;
  iniciada_at: string | null;
  finalizada_at: string | null;
  // AV13 — última modificación relevante (cambio de destino). Null = nunca.
  modificada_at?: string | null;
  km_estimado: number | null;
  km_real: number | null;
  duracion_min: number | null;
}

/** AV13 — un evento del historial de la ruta (cambio de destino, inicio/fin…). */
export interface RutaEvento {
  tipo: string;
  detalle: string | null;
  por: string | null;
  created_at: string;
}

/** AI3 — un punto del trayecto recorrido (tracking AF27). */
export interface TrayectoPunto {
  lat: number;
  lng: number;
  capturado_en: string;
}

/** AE5 — detalle de ejecución de la ruta (ruta_detalle_transporte). */
export interface RutaDetalleTransporte {
  ruta?: RutaCabecera | null; // AI3 — cabecera informativa
  trayecto?: TrayectoPunto[]; // AI3 — recorrido del tracking
  paradas: RutaParadaEjec[];
  conduces: RutaConduceEjec[];
  eventos?: RutaEvento[]; // AV13 — historial (cambios de destino, etc.)
}

/** AF29 — una fila del historial de conduces (mis_conduces_historial). */
export interface ConduceHistorial {
  id: string;
  fecha: string;
  creado_en: string;
  estado: string;
  fase: string | null;
  alto_valor: boolean;
  obra: string | null;
  proyecto_id: string | null;
  bodega: string | null;
  // AP4 — obra de ORIGEN (del almacén de salida) + almacén destino, para distinguir
  // origen/destino en los filtros; responsable_match = roles del usuario en el conduce.
  origen_proyecto_id?: string | null;
  origen_proyecto?: string | null;
  destino_almacen?: string | null;
  responsable_match?: string[] | null;
  ruta_id: string | null;
  observaciones: string | null;
  receptor: string | null;
  entregado_en: string | null;
  confirmado: boolean;
  recibido_en: string | null;
  firma_pendiente: boolean;
  firma_pendiente_nombre: string | null;
  items: { articulo: string; unidad: string; cantidad: number; alto_valor: boolean }[];
}

/** AI2 — una opción del select "Despachante" (usuario o empleado del origen). */
export interface Despachante {
  tipo: 'usuario' | 'empleado';
  id: string;
  nombre: string;
  detalle: string | null;
}

/** AI2 — conduce emitido pendiente de entrega (mis_conduces_pendientes_entrega). */
export interface ConducePendienteEntrega {
  id: string;
  fecha: string;
  proyecto_id: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string;
  fase: string | null;
  created_at: string;
  // AM5 — estado de ruta del conduce (para decidir "Iniciar ruta" vs "En ruta").
  ruta_id?: string | null;
  ruta_estado?: string | null;
  vehiculo_id?: string | null;
  motivo?: string | null;
  tiene_ruta?: boolean;
}

/** AJ8 — entrega esperando confirmación del receptor (bandeja del receptor). */
export interface EntregaPorConfirmar {
  id: string;
  fecha: string;
  proyecto_id: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string;
  fase: string | null;
  entregado_en: string | null;
  entrega_foto_path: string | null;
  /** QA-13 — ítems del conduce para registrar faltantes (si el RPC los provee;
   *  puede venir vacío/ausente offline → la UI degrada al toggle Sí/No). */
  items?: { detalle_id: string; articulo: string; unidad: string; cantidad: number }[];
}

/** AF25 — fila de rutas_activas_y_hoy (activas primero + rutas de hoy). */
export interface RutaActivaHoy {
  id: string;
  seccion: 'activa' | 'hoy';
  estado: string;
  tipo: string;
  origen: string | null;
  destino: string | null;
  placa: string | null;
  marca: string | null; // AT9
  modelo: string | null; // AT9
  color: string | null; // AT9
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  modificada_at?: string | null; // AV13
  paradas_total: number;
  paradas_entregadas: number;
}

/** AP6 — fila del histórico de rutas (todas las creadas) para "Rutas activas". */
export interface RutaHistorial {
  id: string;
  estado: string;
  tipo: string | null;
  origen: string | null;
  destino: string | null;
  destino_proyecto_id: string | null;
  obra: string | null;
  placa: string | null;
  conductor_id: string | null;
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  finalizada_at: string | null;
  km_real: number | null;
  km_estimado: number | null;
  duracion_min: number | null;
  paradas_total: number;
  paradas_entregadas: number;
}

/** AK1 — fila del historial de confirmaciones de entrega. */
export interface ConfirmacionHistorialRow {
  id: string;
  fecha: string;
  created_at: string;
  proyecto_id: string | null;
  proyecto: string | null;
  bodega: string | null;
  estado: string;
  fase: string | null;
  entregado_por: string | null;
  entregado_por_nombre: string | null;
  entregado_en: string | null;
  recibido_por: string | null;
  recibido_por_nombre: string | null;
  recibido_en: string | null;
  tiene_foto: boolean;
  tiene_firma: boolean;
}

/** AK1 — detalle completo de una confirmación (jsonb de confirmacion_detalle). */
export interface ConfirmacionDetalle {
  id: string;
  fecha: string;
  created_at: string;
  estado: string;
  fase: string | null;
  proyecto: string | null;
  bodega: string | null;
  entregado_por_nombre: string | null;
  entregado_en: string | null;
  entrega_foto_path: string | null;
  entrega_foto_url?: string | null;
  recibido_por_nombre: string | null;
  recibido_en: string | null;
  recepcion_foto_path: string | null;
  recepcion_foto_url?: string | null;
  notas_recepcion: string | null;
  items: { articulo: string; cantidad: number; cantidad_recibida: number | null }[] | null;
  firmas: { rol: string; nombre: string | null; firma_path: string | null; firma_url?: string | null; firmado_en: string | null }[] | null;
  confirmaciones:
    | { confirmado_por: string | null; modo: string | null; fotos: string[] | null; fotos_url?: string[]; notas: string | null; checklist: unknown; fecha: string }[]
    | null;
}

/** AL9/AL13/AL4 — detalle completo de un conduce (jsonb de conduce_detalle_app).
 *  Fuente única para: abrir desde cualquier listado (rows clickables), refrescar
 *  tras transferencia (trae SIEMPRE portador/estado actual) y "Ver conduce" (PDF). */
export interface ConduceDetalleItem {
  detalle_id: string;
  articulo_id: string;
  articulo: string | null;
  codigo: string | null;
  unidad: string | null;
  propiedad: string | null;
  cantidad: number;
  cantidad_recibida: number | null;
}
/** AU4 — item libre (material no catalogado) del detalle del conduce. */
export interface ConduceItemLibre {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  articulo_vinculado_id: string | null;
}
export interface ConduceDetalleFirma {
  rol: string;
  nombre: string | null;
  firma_path: string | null;
  firma_url?: string | null;
  firmado_en: string | null;
}
export interface ConduceDetalleTransferencia {
  id: string;
  estado: string;
  fase_al_transferir: string | null;
  de: string | null;
  a: string | null;
  ofrecida_en: string | null;
  resuelta_en: string | null;
}
export interface ConduceDetalle {
  id: string;
  numero: string;
  fecha: string;
  created_at: string;
  estado: string;
  fase: string | null;
  motivo: string | null;
  // AS3 — etiqueta legible del motivo (homologada con la web) + despachante
  // ("Entregado por" real: quien entregó el material al chofer).
  motivo_label?: string | null;
  despachante?: string | null;
  despachante_usuario_id?: string | null;
  firma_despachante_pendiente?: boolean;
  proyecto_id: string | null;
  proyecto: string | null;
  bodega_id: string | null;
  bodega: string | null;
  destino_almacen_id: string | null;
  destino_almacen: string | null;
  conductor_id: string | null;
  conductor: string | null;
  creado_por: string | null;
  creado_por_nombre: string | null;
  entregado_por: string | null;
  entregado_por_nombre: string | null;
  entregado_en: string | null;
  entrega_foto_path: string | null;
  entrega_foto_url?: string | null;
  recibido_por: string | null;
  recibido_por_nombre: string | null;
  recibido_en: string | null;
  recepcion_foto_path: string | null;
  recepcion_foto_url?: string | null;
  notas_recepcion: string | null;
  ruta_id: string | null;
  es_prueba: boolean;
  items: ConduceDetalleItem[];
  /** AU4 — materiales NO catalogados (nota libre) que viajan en el conduce. */
  items_libres?: ConduceItemLibre[];
  firmas: ConduceDetalleFirma[];
  transferencias: ConduceDetalleTransferencia[];
}

/** AS2 — fila de "Conduces por firmar" (el despachante firma desde su teléfono). */
export interface ConducePorFirmar {
  id: string;
  fecha: string;
  created_at: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string | null;
  fase: string | null;
  /**
   * AV1 — ¿el despachante designado (= yo, en esta bandeja) es ELEGIBLE según la
   * matriz única server-side (`es_despachante_elegible`)? Si es false, el conduce
   * quedó con un despachante inválido (datos viejos): NO se ofrece el pad de firma,
   * se muestra "corrección pendiente". Servidores viejos sin la columna → true.
   */
  despachante_elegible: boolean;
}

/**
 * AY13 — un conduce con ≥1 ítem libre aún sin vincular a un artículo del catálogo
 * (no generó movimiento real de inventario). El admin lo resuelve en la web
 * creando/vinculando el artículo; la app solo lo REFLEJA (RPC conduces_por_implementar).
 */
export interface ConducePorImplementar {
  salida_id: string;
  conduce_numero: string | null;
  fecha: string;
  estado: string;
  estado_label: string | null;
  proyecto: string | null;
  bodega: string | null;
  creado_por: string | null;
  pendientes: number; // ítems libres sin vincular
  total_libres: number;
  es_prueba: boolean;
  created_at: string;
}

/** AL10 — almacén central elegible como destino de un conduce (almacenes_destino). */
export interface AlmacenDestino {
  id: string;
  nombre: string;
  es_central: boolean;
  es_principal: boolean;
}

/** Obra o almacén como destino, con sus coordenadas (U22). */
export interface LugarDestino {
  id: string;
  nombre: string;
  tipo: 'obra' | 'almacen';
  latitud: number | null;
  longitud: number | null;
}

/** AH9 — contrato canónico de destinos_transporte() (obra con almacén implícito
 *  resuelto + almacenes sueltos; es_prueba-filtrado server-side). */
export interface DestinoTransporte {
  tipo: 'obra' | 'almacen';
  id: string;
  nombre: string;
  proyecto_id: string | null;
  bodega_id: string | null;
  tiene_bodega: boolean;
  latitud: number | null;
  longitud: number | null;
}

/**
 * Driver's conduces (dispatched material) + routes. Delivery confirmation is
 * enqueued offline and committed via sgc.entregar_conduce, closing SGC's
 * existing despachado → entregado / entregado_incompleto trazabilidad.
 */
@Injectable({ providedIn: 'root' })
export class ConducesService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);
  private store = inject(LocalStore);
  private audioNotas = inject(AudioNotasService);
  private ayudantes = inject(AyudanteService); // AT4

  constructor() {
    this.registerHandler();
  }

  // ---- Y3 — badge de rutas asignadas nuevas -----------------------------

  /**
   * Nº de rutas asignadas a mí en estado `planificada` que aún NO he visto.
   * Fuente: `mis_rutas_hoy` (cacheada, offline-friendly). Se limpia al entrar a
   * "Conduces y rutas" (marcarRutasVistas). Las rutas ya asignadas por el servidor
   * son la fuente de verdad; un cambio de estado propio encolado en el outbox no
   * reintroduce el badge (solo cuentan las que siguen planificadas).
   */
  async rutasPlanificadasNuevas(): Promise<number> {
    const rutas = await this.misRutas();
    const vistas = new Set(await this.getVistas());
    return rutas.filter((r) => r.estado === 'planificada' && !vistas.has(r.id)).length;
  }

  /** Marca como vistas todas las rutas planificadas actuales (limpia el badge). */
  async marcarRutasVistas(): Promise<void> {
    const rutas = await this.misRutas();
    const ids = rutas.filter((r) => r.estado === 'planificada').map((r) => r.id);
    await this.store.set(VISTAS_KEY, JSON.stringify(ids));
  }

  private async getVistas(): Promise<string[]> {
    const raw = await this.store.get(VISTAS_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as string[]) : [];
    } catch {
      return [];
    }
  }

  async misConduces(): Promise<Conduce[]> {
    const data = await this.catalog.refresh<Conduce[]>(CATALOG_CONDUCES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_hoy');
      if (error) throw new Error(error.message);
      return (data as Conduce[]) ?? [];
    });
    return data ?? [];
  }

  async misRutas(): Promise<RutaHoy[]> {
    const data = await this.catalog.refresh<RutaHoy[]>(CATALOG_RUTAS, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_rutas_hoy');
      if (error) throw new Error(error.message);
      return (data as RutaHoy[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AC13/AC6 — detalle de una ruta para el app: paradas (en orden) + fotos de
   * evidencia inicial (URLs firmadas). Online best-effort, cacheado por ruta para
   * que se vea offline tras la primera carga. La RLS permite al creador/conductor.
   */
  async getRutaDetalle(rutaId: string): Promise<RutaDetalleApp> {
    const data = await this.catalog.refresh<RutaDetalleApp>(`ruta_detalle:${rutaId}`, async () => {
      const [par, fot] = await Promise.all([
        this.supabase.client
          .from('ruta_paradas')
          .select('orden, ubicacion, notas')
          .eq('ruta_id', rutaId)
          .order('orden', { ascending: true }),
        this.supabase.client
          .from('ruta_fotos')
          .select('storage_path, orden')
          .eq('ruta_id', rutaId)
          .order('orden', { ascending: true }),
      ]);
      if (par.error) throw new Error(par.error.message);
      const paradas = ((par.data as Array<Record<string, unknown>>) ?? []).map((p) => ({
        orden: (p['orden'] as number) ?? 0,
        ubicacion: (p['ubicacion'] as string) ?? '',
        notas: (p['notas'] as string) ?? null,
      }));
      // Firmar las URLs de las fotos (bucket flota-documentos). Tolerante a error.
      const fotos: string[] = [];
      for (const f of (fot.data as Array<{ storage_path: string }> | null) ?? []) {
        const { data: signed } = await this.supabase.client.storage
          .from(AUDIO_BUCKET_FLOTA)
          .createSignedUrl(f.storage_path, 3600);
        if (signed?.signedUrl) fotos.push(signed.signedUrl);
      }
      return { paradas, fotos };
    });
    return data ?? { paradas: [], fotos: [] };
  }

  /**
   * AE5 — detalle de EJECUCIÓN de la ruta: paradas con su estado/evidencia y el
   * conduce vinculado a cada una, + los conduces de la ruta. Cacheado por ruta
   * (offline tras la primera carga). El chofer asignado/creador la puede leer.
   */
  async getRutaDetalleTransporte(rutaId: string): Promise<RutaDetalleTransporte> {
    const data = await this.catalog.refresh<RutaDetalleTransporte>(
      `ruta_detalle_t:${rutaId}`,
      async () => {
        const { data, error } = await this.supabase.client.rpc('ruta_detalle_transporte', {
          p_ruta_id: rutaId,
        });
        if (error) throw new Error(error.message);
        const d = (data as Partial<RutaDetalleTransporte>) ?? {};
        return {
          ruta: d.ruta ?? null,
          trayecto: d.trayecto ?? [],
          paradas: d.paradas ?? [],
          conduces: d.conduces ?? [],
          eventos: d.eventos ?? [], // AV13
        };
      },
    );
    return data ?? { ruta: null, trayecto: [], paradas: [], conduces: [], eventos: [] };
  }

  /**
   * AE5 — ata un conduce PROPIO/asignado a una parada (y de paso a su ruta):
   * "este material va a esta parada". OFFLINE-first por outbox (idempotente); la
   * UI aplica el cambio de forma optimista.
   */
  async vincularConduceParada(salidaId: string, paradaId: string): Promise<void> {
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'conduce_vincular_parada',
      capturado_en,
      payload: { salida_id: salidaId, parada_id: paradaId },
      resumen: { tipo: 'vincular_parada', salida_id: salidaId, capturado_en },
    });
  }

  /**
   * AE5 — avanza el estado de una parada (pendiente → en_camino → entregada), con
   * evidencia opcional (nombre de quien recibió + nota). Para paradas SIN conduce
   * (traslado/personal) o cierre manual; las paradas CON conduce se cierran solas
   * al entregarse el conduce (trigger). OFFLINE-first por outbox (idempotente).
   */
  async avanzarParada(
    paradaId: string,
    estado: ParadaEstado,
    opts: {
      entregadoA?: string | null;
      notas?: string | null;
      foto?: Blob | null;
      firma?: Blob | null;
      /** AH8 — ubicación donde el chofer completó la parada (tap). */
      lat?: number | null;
      lng?: number | null;
    } = {},
  ): Promise<void> {
    const capturado_en = new Date().toISOString();
    const opId = crypto.randomUUID();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (opts.foto) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `paradas/${paradaId}/${opId}-foto.jpg`, slot: 'parada_foto', blob: opts.foto });
    }
    if (opts.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `paradas/${paradaId}/${opId}-firma.png`, slot: 'parada_firma', blob: opts.firma });
    }
    await this.sync.enqueue({
      id: opId,
      tipo_op: 'parada_avanzar',
      capturado_en,
      payload: {
        parada_id: paradaId,
        estado,
        entregado_a: opts.entregadoA ?? null,
        notas: opts.notas ?? null,
        at: capturado_en, // AH8 — instante del tap (offline-safe)
        lat: opts.lat ?? null, // AH8 — ubicación de completado
        lng: opts.lng ?? null,
      },
      fotos,
      resumen: { tipo: 'avanzar_parada', parada_id: paradaId, capturado_en },
    });
  }

  /** AE5 — fuerza el refetch del detalle de una ruta tras una mutación. */
  async invalidarRutaDetalle(rutaId: string): Promise<void> {
    await this.catalog.invalidate(`ruta_detalle_t:${rutaId}`);
  }

  /**
   * AF25 — RUTA VIVA: agregar una parada a mitad de ruta. Offline-first por outbox
   * (idempotente por op-id; el servidor registra el evento en ruta_eventos).
   */
  async agregarParadaRuta(
    rutaId: string,
    ubicacion: string,
    opts: { proyectoId?: string | null; lat?: number | null; lng?: number | null; notas?: string | null } = {},
  ): Promise<void> {
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'ruta_agregar_parada',
      capturado_en,
      payload: {
        ruta_id: rutaId,
        ubicacion,
        proyecto_id: opts.proyectoId ?? null,
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
        notas: opts.notas ?? null,
      },
      resumen: { tipo: 'agregar_parada', ruta_id: rutaId, ubicacion, capturado_en },
    });
  }

  /**
   * AF25 — RUTA VIVA: cambiar el destino (no existe "cancelar": es cambio de destino,
   * y se trackea con quién/cuándo/dónde en ruta_eventos). Offline-first por outbox.
   */
  async cambiarDestinoRuta(
    rutaId: string,
    destino: string,
    opts: { proyectoId?: string | null; lat?: number | null; lng?: number | null } = {},
  ): Promise<void> {
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'ruta_cambiar_destino',
      capturado_en,
      payload: {
        ruta_id: rutaId,
        destino,
        proyecto_id: opts.proyectoId ?? null,
        lat: opts.lat ?? null,
        lng: opts.lng ?? null,
      },
      resumen: { tipo: 'cambiar_destino', ruta_id: rutaId, destino, capturado_en },
    });
    void this.misRutas();
  }

  /**
   * AF25/AF29 — listado "Rutas activas" (en_curso, arriba) + "Rutas de hoy".
   * Cacheado (offline-friendly). El jefe de flota ve todas; el chofer las suyas.
   */
  async rutasActivasYHoy(): Promise<RutaActivaHoy[]> {
    const data = await this.catalog.refresh<RutaActivaHoy[]>('rutas_activas_hoy', async () => {
      const { data, error } = await this.supabase.client.rpc('rutas_activas_y_hoy');
      if (error) throw new Error(error.message);
      return (data as RutaActivaHoy[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AP6 — histórico de rutas (todas las creadas) para el submódulo "Rutas activas".
   * Elevados ven todas; el resto las suyas (verdad server-side). Filtros combinables:
   * chofer, rango de fechas, obra (destino) y estado. Cacheado por combinación.
   */
  async rutasHistorial(
    opts: {
      conductorId?: string | null;
      desde?: string | null;
      hasta?: string | null;
      obraId?: string | null;
      estado?: string | null;
    } = {},
  ): Promise<RutaHistorial[]> {
    const key = `rutas_hist:${opts.conductorId ?? ''}:${opts.desde ?? ''}:${opts.hasta ?? ''}:${opts.obraId ?? ''}:${opts.estado ?? ''}`;
    const data = await this.catalog.refresh<RutaHistorial[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('rutas_historial', {
        p_conductor: opts.conductorId ?? null,
        p_desde: opts.desde ?? null,
        p_hasta: opts.hasta ?? null,
        p_obra: opts.obraId ?? null,
        p_estado: opts.estado ?? null,
        p_limite: 200,
      });
      if (error) throw new Error(error.message);
      return (data as RutaHistorial[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AF29 — historial de conduces (matriz de visibilidad server-side). Online-first
   * con cache razonable (histórico no necesita offline completo). Los filtros
   * (fecha/obra) van al servidor; el filtro por fase se aplica en la UI.
   */
  async misConducesHistorial(
    opts: {
      desde?: string | null;
      hasta?: string | null;
      proyectoId?: string | null;
      // AP4 — filtros combinables del histórico.
      obraOrigen?: string | null;
      obraDestino?: string | null;
      rol?: 'emisor' | 'chofer' | 'receptor' | null;
    } = {},
  ): Promise<ConduceHistorial[]> {
    const key = `conduces_hist:${opts.desde ?? ''}:${opts.hasta ?? ''}:${opts.proyectoId ?? ''}:${opts.obraOrigen ?? ''}:${opts.obraDestino ?? ''}:${opts.rol ?? ''}`;
    const data = await this.catalog.refresh<ConduceHistorial[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_historial', {
        p_desde: opts.desde ?? null,
        p_hasta: opts.hasta ?? null,
        p_proyecto_id: opts.proyectoId ?? null,
        p_limite: 200,
        p_obra_origen: opts.obraOrigen ?? null,
        p_obra_destino: opts.obraDestino ?? null,
        p_rol: opts.rol ?? null,
      });
      if (error) throw new Error(error.message);
      return (data as ConduceHistorial[]) ?? [];
    });
    return data ?? [];
  }

  /** AI2 — universo del select "Despachante" (usuarios + empleados). Cacheado. */
  async despachantesDisponibles(bodegaId?: string | null, proyectoId?: string | null): Promise<Despachante[]> {
    // AJ6 — con contexto (bodega/obra) pedimos fresco para que los vinculados a esa
    // obra/almacén salgan primero; sin contexto usamos la caché (offline-friendly).
    if (bodegaId || proyectoId) {
      try {
        const { data, error } = await this.supabase.client.rpc('despachantes_disponibles', {
          p_bodega_id: bodegaId ?? null,
          p_proyecto_id: proyectoId ?? null,
        });
        if (error) throw new Error(error.message);
        return (data as Despachante[]) ?? [];
      } catch {
        /* offline / error → caché 0-arg abajo */
      }
    }
    const data = await this.catalog.refresh<Despachante[]>('despachantes', async () => {
      const { data, error } = await this.supabase.client.rpc('despachantes_disponibles');
      if (error) throw new Error(error.message);
      return (data as Despachante[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AI2 — conduces emitidos pendientes de entrega (para el menú Conduce).
   * QA-6 — read-through cache (como misConduces/misRutas): la última foto del
   * servidor sobrevive offline. Online el comportamiento es idéntico.
   */
  async misConducesPendientesEntrega(): Promise<ConducePendienteEntrega[]> {
    const data = await this.catalog.refresh<ConducePendienteEntrega[]>(CATALOG_PENDIENTES_ENTREGA, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega');
      if (error) throw new Error(error.message);
      return (data as ConducePendienteEntrega[]) ?? [];
    });
    return data ?? [];
  }

  /** AI2 — contador de conduces pendientes de entrega (badge). Best-effort. */
  async pendientesEntregaCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega_count');
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  /**
   * AM5 — arranca (o crea+adjunta) la ruta de un conduce emitido. Tras esto el
   * conduce sale en "Mis rutas" y en Seguimiento. Requiere vehículo (el del conduce
   * o el pasado; DR461 si falta, DR462 si no hay chofer). Online: iniciar una ruta
   * enciende el tracking, que necesita conectividad; el mensaje del server ya viene
   * accionable. Devuelve el ruta_id resultante.
   */
  async conduceIniciarRuta(salidaId: string, vehiculoId?: string | null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('conduce_iniciar_ruta', {
      p_salida_id: salidaId,
      p_vehiculo_id: vehiculoId ?? null,
    });
    if (error) throw new Error(error.message);
    // El conduce y su ruta cambiaron → refrescar mis listados vivos.
    await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    await this.catalog.invalidate(CATALOG_RUTAS).catch(() => {});
    await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
    return (data as { ruta_id?: string } | null)?.ruta_id ?? '';
  }

  /** Obras/proyectos for the route destination picker (shared cache). */
  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>(CATALOG_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre, latitud, longitud')
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AH9 — obras (destino real; su almacén va implícito y se resuelve server-side) +
   * almacenes NO ligados a obra (ej. Bodega Central). Contrato canónico único
   * `destinos_transporte()`: filtra es_prueba (AH11 — sin "Test") y NUNCA expone los
   * almacenes de una obra como opción suelta. Reemplaza la mezcla obras+todas-las-
   * bodegas anterior. `id` = proyecto (obra) | bodega (almacén suelto), como antes.
   */
  async getLugaresDestino(): Promise<LugarDestino[]> {
    const data = await this.catalog.refresh<LugarDestino[]>('lugares_destino', async () => {
      const { data: rows, error } = await this.supabase.client.rpc('destinos_transporte');
      if (error) throw new Error(error.message);
      return ((rows as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: r['id'] as string,
        nombre: r['nombre'] as string,
        tipo: (r['tipo'] as 'obra' | 'almacen') ?? 'obra',
        latitud: (r['latitud'] as number) ?? null,
        longitud: (r['longitud'] as number) ?? null,
      }));
    });
    return data ?? [];
  }

  /**
   * AH9 — contrato canónico de destinos (obras con almacén resuelto + almacenes
   * sueltos), para flujos que necesitan resolver la bodega implícita de una obra.
   */
  async getDestinos(): Promise<DestinoTransporte[]> {
    const data = await this.catalog.refresh<DestinoTransporte[]>('destinos_transporte', async () => {
      const { data: rows, error } = await this.supabase.client.rpc('destinos_transporte');
      if (error) throw new Error(error.message);
      return (rows as DestinoTransporte[]) ?? [];
    });
    return data ?? [];
  }

  /** Queue a new route (R7). Offline-safe via the outbox; idempotent by UUID. */
  async crearRuta(input: RutaCaptura): Promise<void> {
    // AV11 — id estable si el wizard lo provee (idempotencia por p_id al reanudar).
    const id = input.id ?? crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    // Z23 — notas de voz (audio_notas, bucket flota-documentos).
    const audio = this.audioNotas.buildAttachments('ruta', id, AUDIO_BUCKET_FLOTA, input.voces ?? []);
    // AC6 — fotos de evidencia inicial (bucket flota-documentos, slot foto_N).
    const evidencia = (input.fotos ?? []).map((blob, i) => ({
      id: crypto.randomUUID(),
      bucket: AUDIO_BUCKET_FLOTA,
      path: `ruta/${id}/evidencia_${i}.jpg`,
      slot: `foto_${i}`,
      blob,
    }));
    await this.sync.enqueue({
      id,
      tipo_op: 'crear_ruta',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        conductor_id: input.conductorId,
        tipo: input.tipo ?? 'material', // AD6
        origen: input.origen,
        destino: input.destino,
        fecha: input.fecha,
        destino_proyecto_id: input.destinoProyectoId,
        km_estimado: input.kmEstimado,
        notas: input.notas,
        origen_lat: input.origen_lat,
        origen_lng: input.origen_lng,
        destino_lat: input.destino_lat,
        destino_lng: input.destino_lng,
        capturado_en,
        audios: audio.audios, // Z23
        paradas: input.paradas ?? [], // AC13
        n_fotos: evidencia.length, // AC6
        tarea_vinculada: input.tareaVinculada ?? null, // AG15
        solicitud_id: input.solicitudId ?? null, // AY11
        ayudante_id: input.ayudanteId ?? null, // AT4
      },
      fotos: [...audio.fotos, ...evidencia],
      resumen: { origen: input.origen, destino: input.destino, fecha: input.fecha, capturado_en },
    });
    void this.misRutas();
  }

  /**
   * Y4 — cambia el estado de la ruta registrando el instante del TAP (`p_at`),
   * no el momento en que el servidor procesa la llamada. El servidor lo usa con
   * sanity-check (no futuro, no anterior a la creación; fin ≥ inicio).
   *
   * AE7 — OFFLINE-first: iniciar/completar/cancelar una ruta va por el OUTBOX
   * (antes llamaba al RPC directo y fallaba sin señal, rompiendo el contrato
   * offline como el resto del flujo). El `at` es el instante del TAP, así que el
   * proceso diferido no altera los tiempos. El RPC `marcar_ruta_estado` es
   * idempotente (fija el estado con sanity-check) → seguro ante reintentos.
   */
  async marcarRuta(
    rutaId: string,
    estado: 'en_curso' | 'completada' | 'cancelada',
    at: string = new Date().toISOString(),
  ): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'ruta_estado',
      capturado_en: at,
      payload: { ruta_id: rutaId, estado, at },
      resumen: { tipo: 'ruta_estado', ruta_id: rutaId, estado, capturado_en: at },
    });
    void this.misRutas();
  }

  /**
   * AE — el chofer GENERA un conduce (salida de material) desde una bodega hacia
   * una obra. Offline-safe por outbox; el servidor valida el stock (idempotente
   * por UUID). Aparece luego en "Conduces por entregar" para entregarlo con firmas.
   */
  async crearConduceTransportista(input: ConduceTransportistaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    // AF23.3 — firma del emisor (quien entrega) al emitir: se sube y se sella con
    // firmar_conduce(rol emisor) dentro del mismo handler (idempotente).
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (input.firmaEmisor) {
      fotos.push({
        id: crypto.randomUUID(),
        bucket: 'conduces',
        path: `${id}/${id}-firma-emisor.png`,
        slot: 'firma_emisor',
        blob: input.firmaEmisor,
      });
    }
    // AH4 — segunda firma (chofer que transporta). Cuando entrega y transporta la
    // misma persona, este blob es idéntico al del emisor (una firma, doble rol).
    if (input.firmaTransportista) {
      fotos.push({
        id: crypto.randomUUID(),
        bucket: 'conduces',
        path: `${id}/${id}-firma-transportista.png`,
        slot: 'firma_transportista',
        blob: input.firmaTransportista,
      });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_transportista',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_id: input.bodegaId ?? null,
        proyecto_id: input.proyectoId,
        observaciones: input.observaciones,
        vehiculo_id: input.vehiculoId ?? null,
        ruta_id: input.rutaId ?? null,
        items: input.items,
        emisor_nombre: input.emisorNombre ?? null,
        emisor_es_otro: input.emisorEsOtro ?? false, // AH4
        transportista_nombre: input.transportistaNombre ?? null, // AH4
        tarea_vinculada: input.tareaVinculada ?? null, // AG15
      },
      fotos,
      resumen: { bodega_id: input.bodegaId, proyecto_id: input.proyectoId, capturado_en },
    });
    void this.misConduces();
  }

  /**
   * AI2 — conduce simplificado: emite con despachante + foto de recepción + firmas
   * de chofer y despachante en un solo RPC (`crear_conduce_simple`, que sella ambas
   * firmas server-side). Offline-safe por outbox; idempotente por UUID. Al emitir
   * queda en "Pendiente entrega".
   */
  async crearConduceSimple(input: ConduceSimpleCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (input.fotoRecepcion) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-recepcion.jpg`, slot: 'carga', blob: input.fotoRecepcion });
    }
    if (input.firmaChofer) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-firma-chofer.png`, slot: 'firma_chofer', blob: input.firmaChofer });
    }
    if (input.firmaDespachante) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-firma-despachante.png`, slot: 'firma_despachante', blob: input.firmaDespachante });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_simple',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_id: input.bodegaId ?? null,
        proyecto_id: input.proyectoId,
        observaciones: input.observaciones,
        vehiculo_id: input.vehiculoId ?? null,
        items: input.items,
        despachante_nombre: input.despachanteNombre ?? null,
        despachante_usuario_id: input.despachanteUsuarioId ?? null,
        despachante_empleado_id: input.despachanteEmpleadoId ?? null,
        destino_almacen_id: input.destinoAlmacenId ?? null, // AL10
        tarea_vinculada: input.tareaVinculada ?? null,
        items_libres: input.itemsLibres ?? [], // AU4 — material no catalogado (nota libre)
        ayudante_id: input.ayudanteId ?? null, // AT4
        receptor_usuario_id: input.receptorUsuarioId ?? null, // AT16
        receptor_nombre: input.receptorNombre ?? null, // AT16
        origen_requisicion_id: input.origenRequisicionId ?? null, // BA/FASE2 despacho
      },
      fotos,
      resumen: { bodega_id: input.bodegaId, proyecto_id: input.proyectoId, capturado_en },
    });
    void this.misConduces();
    // QA-6 — el nuevo conduce cae en "Pendiente entrega": invalida su caché para
    // que la próxima lectura lo traiga (se materializa al drenar el outbox online).
    void this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    return id; // AO4 — id (idempotente) para deep-link al detalle tras emitir.
  }

  // ── BA/Transporte v3 (FASE 1) — Conduce externo + proveedores ──────────────

  /** Catálogo de proveedores de transportación (cache-then-network, offline-safe). */
  async proveedoresTransporte(): Promise<ProveedorTransporte[]> {
    const data = await this.catalog.refresh<ProveedorTransporte[]>('proveedores_transporte', async () => {
      const { data: rows, error } = await this.supabase.client.rpc('proveedores_transporte_listado', {
        p_solo_por_ratificar: false,
      });
      if (error) throw new Error(error.message);
      return (rows as ProveedorTransporte[]) ?? [];
    });
    return data ?? [];
  }

  /** Alta al vuelo de un proveedor (nace "sin ratificar"; usable de inmediato). Online. */
  async crearProveedorTransporte(nombre: string, telefono?: string | null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('proveedor_transporte_crear', {
      p_nombre: nombre.trim(),
      p_telefono: telefono?.trim() || null,
      p_contacto: null,
      p_rnc: null,
      p_notas: null,
    });
    if (error) throw new Error(error.message);
    void this.catalog.invalidate('proveedores_transporte').catch(() => {});
    return data as string;
  }

  /**
   * BA/FASE 1 — crea un conduce externo (un proveedor transporta). Offline-safe vía
   * outbox: sube la(s) foto(s) de placa/carga y llama a `crear_conduce_externo`. El
   * viaje al proveedor y la bandeja de «Otros» los registra el servidor al emitir.
   */
  async crearConduceExterno(input: ConduceExternoCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [
      { id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-placa.jpg`, slot: 'placa', blob: input.placaFoto },
    ];
    if (input.cargaFoto) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-carga.jpg`, slot: 'carga', blob: input.cargaFoto });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_externo',
      capturado_en,
      payload: {
        id,
        transporta_proveedor_id: input.transportaProveedorId ?? null,
        transporta_texto: input.transportaTexto ?? null,
        material_descripcion: input.materialDescripcion ?? null,
        items: input.items ?? null,
        origen: input.origen?.nombre ?? null,
        origen_lat: input.origen?.lat ?? null,
        origen_lng: input.origen?.lng ?? null,
        origen_proyecto_id: input.origen?.proyecto_id ?? null,
        origen_bodega_id: input.origen?.bodega_id ?? null,
        destino: input.destino?.nombre ?? null,
        destino_lat: input.destino?.lat ?? null,
        destino_lng: input.destino?.lng ?? null,
        destino_proyecto_id: input.destino?.proyecto_id ?? null,
        destino_bodega_id: input.destino?.bodega_id ?? null,
        origen_requisicion_id: input.origenRequisicionId ?? null,
      },
      fotos,
      resumen: { transporta: input.transportaTexto ?? 'proveedor', capturado_en },
    });
    return id;
  }

  // ── BA/Transporte v3 (FASE 2) — Despachos ──────────────────────────────────

  /** Requisiciones "por despachar" que el chofer/logística puede jalar. */
  async requisicionesPorDespachar(): Promise<RequisicionPorDespachar[]> {
    const data = await this.catalog.refresh<RequisicionPorDespachar[]>('requisiciones_por_despachar', async () => {
      const { data: rows, error } = await this.supabase.client.rpc('requisiciones_por_despachar');
      if (error) throw new Error(error.message);
      return (rows as RequisicionPorDespachar[]) ?? [];
    });
    return data ?? [];
  }

  /** Avance de una requisición (solicitado vs despachado, renglón por renglón). */
  async requisicionAvance(id: string): Promise<RenglonAvance[]> {
    const { data, error } = await this.supabase.client.rpc('requisicion_avance', { p_solicitud_id: id });
    if (error) throw new Error(error.message);
    return (data as RenglonAvance[]) ?? [];
  }

  /** ¿La requisición ya tiene despachos en curso? (aviso suave de duplicado). */
  async requisicionTieneDespachos(id: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('requisicion_tiene_despachos', { p_solicitud_id: id });
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /**
   * AQ10 — Eliminar (anular) un conduce creado por error. Soft-delete server-side
   * vía `anular_conduce`: repone el stock si descontó del origen y cancela la ruta
   * vinculada (o solo omite esta parada en rutas multi-parada). Solo el emisor
   * mientras esté PENDIENTE (sin entregar ni confirmar) o un admin — el server valida
   * y rechaza lo demás con un mensaje claro. Va por outbox (idempotente) para que
   * el conduce desaparezca al instante y se materialice al drenar.
   */
  async eliminarConduce(salidaId: string, motivo?: string | null): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'conduce_eliminar',
      capturado_en: new Date().toISOString(),
      payload: { salida_id: salidaId, motivo: (motivo ?? '').trim() || null },
      fotos: [],
      resumen: { salida_id: salidaId },
    });
    void this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    void this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
  }

  /**
   * AM1 — devolución a suplidor por contrato explícito: origen (bodega) OBLIGATORIO
   * y nombrado; sin destino de obra/almacén; motivo 'devolucion' server-side. Blinda
   * el bug del bodega_id null (el server rechaza con DR451 si el origen no resuelve).
   * Offline-safe por outbox; idempotente por UUID.
   */
  async crearConduceDevolucionSuplidor(input: ConduceDevolucionSuplidorCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (input.fotoRecepcion) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-recepcion.jpg`, slot: 'carga', blob: input.fotoRecepcion });
    }
    if (input.firmaChofer) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-firma-chofer.png`, slot: 'firma_chofer', blob: input.firmaChofer });
    }
    if (input.firmaDespachante) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${id}/${id}-firma-despachante.png`, slot: 'firma_despachante', blob: input.firmaDespachante });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_devolucion_suplidor',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_origen_id: input.bodegaOrigenId,
        proyecto_origen_id: input.proyectoOrigenId ?? null,
        observaciones: input.observaciones,
        vehiculo_id: input.vehiculoId ?? null,
        items: input.items,
        despachante_nombre: input.despachanteNombre ?? null,
        despachante_usuario_id: input.despachanteUsuarioId ?? null,
        despachante_empleado_id: input.despachanteEmpleadoId ?? null,
        items_libres: input.itemsLibres ?? [], // AU4 — material no catalogado (nota libre)
        ayudante_id: input.ayudanteId ?? null, // AT4
      },
      fotos,
      resumen: { bodega_id: input.bodegaOrigenId, suplidor: input.suplidorNombre, capturado_en },
    });
    void this.misConduces();
    void this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    return id; // AO4 — id (idempotente) para deep-link al detalle tras emitir.
  }

  // ─── AJ8 — Estados del conduce (chofer) + confirmación del receptor ─────────

  /**
   * AJ8 — el chofer marca el avance de su conduce: `en_transito` / `entregando`.
   * Offline-safe por outbox (idempotente: el RPC solo avanza fases válidas).
   */
  async conduceActualizarEstado(salidaId: string, estado: 'en_transito' | 'entregando'): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_estado_op',
      capturado_en: new Date().toISOString(),
      payload: { salida_id: salidaId, estado },
      fotos: [],
      resumen: { tipo: 'conduce_estado_op', salida_id: salidaId, estado },
    });
    void this.misConducesPendientesEntrega().catch(() => {});
  }

  /**
   * AJ8 — el chofer marca ENTREGADO con foto de entrega OBLIGATORIA (NO firma del
   * receptor). Deja el conduce pendiente de confirmación y notifica a los
   * receptores del destino. Offline-safe por outbox.
   */
  async conduceMarcarEntregado(
    salidaId: string,
    fotoEntrega: Blob,
    items: { detalle_id: string; cantidad_recibida: number }[] | null,
    notas: string | null,
  ): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_entregado',
      capturado_en: new Date().toISOString(),
      payload: { salida_id: salidaId, items: items ?? null, notas: notas ?? null },
      fotos: [
        { id: crypto.randomUUID(), bucket: 'conduces', path: `${salidaId}/${id}-entrega.jpg`, slot: 'entrega', blob: fotoEntrega },
      ],
      resumen: { tipo: 'conduce_entregado', salida_id: salidaId },
    });
    void this.misConducesPendientesEntrega().catch(() => {});
  }

  /** AJ8 — fase actual del conduce (emitido/en_transito/entregando/entregado/…). */
  async conduceFase(salidaId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('conduce_fase', { p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    return (data as string) ?? 'emitido';
  }

  /**
   * AJ8 — bandeja del RECEPTOR: entregas esperando su confirmación.
   * QA-6 — read-through cache (offline-friendly). Online idéntico.
   */
  async misEntregasPorConfirmar(): Promise<EntregaPorConfirmar[]> {
    const data = await this.catalog.refresh<EntregaPorConfirmar[]>(CATALOG_POR_CONFIRMAR, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_entregas_por_confirmar');
      if (error) throw new Error(error.message);
      return (data as EntregaPorConfirmar[]) ?? [];
    });
    return data ?? [];
  }

  /** AJ8 — contador de entregas por confirmar (badge del home/hub). Best-effort. */
  async entregasPorConfirmarCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_entregas_por_confirmar_count');
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  }

  // ── AK1 — Historial de confirmaciones de entrega ──────────────────────────
  /**
   * AK1 — historial filtrable de confirmaciones (fecha/obra/estado). La visibilidad
   * la resuelve el server por matriz (admin/roles globales todo; responsables sus
   * obras; chofer/emisor lo suyo). Best-effort online (cacheado offline-friendly).
   */
  async confirmacionesHistorial(f?: {
    desde?: string | null;
    hasta?: string | null;
    proyectoId?: string | null;
    estado?: 'completa' | 'incompleta' | null;
  }): Promise<ConfirmacionHistorialRow[]> {
    const key = `confirmaciones_historial:${f?.desde ?? ''}:${f?.hasta ?? ''}:${f?.proyectoId ?? ''}:${f?.estado ?? ''}`;
    const data = await this.catalog.refresh<ConfirmacionHistorialRow[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('confirmaciones_historial', {
        p_desde: f?.desde ?? null,
        p_hasta: f?.hasta ?? null,
        p_proyecto_id: f?.proyectoId ?? null,
        p_estado: f?.estado ?? null,
      });
      if (error) throw new Error(error.message);
      return (data as ConfirmacionHistorialRow[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AL8 — "Mis confirmaciones": historial de lo que YO confirmé (recibido_por =
   * yo). Subconjunto del historial global. Mapea al mismo shape de fila para
   * reusar la UI del historial. `mis_confirmaciones(p_desde, p_hasta)`.
   */
  async misConfirmaciones(f?: { desde?: string | null; hasta?: string | null }): Promise<ConfirmacionHistorialRow[]> {
    const key = `mis_confirmaciones:${f?.desde ?? ''}:${f?.hasta ?? ''}`;
    const data = await this.catalog.refresh<ConfirmacionHistorialRow[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_confirmaciones', {
        p_desde: f?.desde ?? null,
        p_hasta: f?.hasta ?? null,
      });
      if (error) throw new Error(error.message);
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: r['id'] as string,
        fecha: r['fecha'] as string,
        created_at: r['created_at'] as string,
        proyecto_id: (r['proyecto_id'] as string) ?? null,
        proyecto: (r['destino'] as string) ?? null, // mis_confirmaciones expone `destino`
        bodega: (r['bodega'] as string) ?? null,
        estado: r['estado'] as string,
        fase: (r['fase'] as string) ?? null,
        entregado_por: (r['entregado_por'] as string) ?? null,
        entregado_por_nombre: (r['entregado_por_nombre'] as string) ?? null,
        entregado_en: (r['entregado_en'] as string) ?? null,
        recibido_por: null,
        recibido_por_nombre: null,
        recibido_en: (r['recibido_en'] as string) ?? null,
        tiene_foto: (r['tiene_foto'] as boolean) ?? false,
        tiene_firma: (r['tiene_firma'] as boolean) ?? false,
      }));
    });
    return data ?? [];
  }

  // ── AS2 — firma remota del despachante ──────────────────────────────────────

  /** AS2 — conduces donde YO soy el despachante y aún no he firmado. */
  async misConducesPorFirmar(): Promise<ConducePorFirmar[]> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_por_firmar');
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      id: r['id'] as string,
      fecha: r['fecha'] as string,
      created_at: (r['created_at'] as string) ?? null,
      destino: (r['destino'] as string) ?? null,
      bodega: (r['bodega'] as string) ?? null,
      estado: (r['estado'] as string) ?? null,
      fase: (r['fase'] as string) ?? null,
      // AV1 — la matriz única expone si el despachante actual es elegible.
      despachante_elegible: (r['despachante_elegible'] as boolean) ?? true,
    }));
  }

  /**
   * AV1 — ¿soy un despachante ELEGIBLE para ESTE conduce? Lee la matriz única
   * server-side vía `mis_conduces_por_firmar` (columna `despachante_elegible`, que
   * es `es_despachante_elegible(auth.uid())`). El pad de firma del detalle se gatea
   * con esto: un inelegible NUNCA dibuja una firma que el servidor va a rechazar.
   * Devuelve null si el conduce no está en mi bandeja (no aplica / sin señal).
   */
  async soyDespachanteElegiblePara(salidaId: string): Promise<boolean | null> {
    const rows = await this.misConducesPorFirmar();
    const row = rows.find((r) => r.id === salidaId);
    return row ? row.despachante_elegible : null;
  }

  /**
   * AU1 — ¿le falta al conduce la firma del despachante? El chofer NO puede
   * marcar la entrega hasta que sea false (regla server-side DR456). Se usa para
   * bloquear proactivamente en la pantalla de entrega (el outbox no puede
   * mostrar el rechazo DR456 en el momento). Requiere red; sin red devuelve false
   * (el server igual bloquea al sincronizar).
   */
  async conduceFirmaDespachantePendiente(salidaId: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('conduce_firma_despachante_pendiente', {
      p_salida_id: salidaId,
    });
    if (error) return false;
    return (data as boolean) ?? false;
  }

  /**
   * AV3 — "Recordarle al despachante": re-avisa al despachante que un conduce
   * sigue esperando su firma (re-push manual). Devuelve el nombre del despachante,
   * o null si ya firmó (nada que recordar). Requiere red.
   */
  async recordarDespachante(salidaId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.rpc('conduce_recordar_despachante', {
      p_salida_id: salidaId,
    });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  }

  /**
   * AY13 — conduces con ítems libres sin vincular ("por implementar"). Read-only:
   * el vínculo del artículo es del admin (web); la app lo lista con su badge.
   */
  async conducesPorImplementar(): Promise<ConducePorImplementar[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_por_implementar');
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      salida_id: r['salida_id'] as string,
      conduce_numero: (r['conduce_numero'] as string) ?? null,
      fecha: r['fecha'] as string,
      estado: r['estado'] as string,
      estado_label: (r['estado_label'] as string) ?? null,
      proyecto: (r['proyecto'] as string) ?? null,
      bodega: (r['bodega'] as string) ?? null,
      creado_por: (r['creado_por'] as string) ?? null,
      pendientes: (r['pendientes'] as number) ?? 0,
      total_libres: (r['total_libres'] as number) ?? 0,
      es_prueba: (r['es_prueba'] as boolean) ?? false,
      created_at: r['created_at'] as string,
    }));
  }

  /** AY13 — cuántos conduces están "por implementar" (badge del hub). */
  async conducesPorImplementarCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('conduces_por_implementar_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** AS2 — cuántos conduces tengo por firmar (para el badge). */
  async misConducesPorFirmarCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_por_firmar_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /**
   * AS2 — firma un conduce COMO despachante desde MI sesión (anti-fraude). Sube la
   * firma al bucket conduces y llama `conduce_firmar_despachante` (el server valida
   * que auth.uid = despachante designado). Acción online (el despachante tiene señal).
   */
  async firmarComoDespachante(salidaId: string, firma: Blob): Promise<void> {
    const { data: userData } = await this.supabase.client.auth.getUser();
    const uid = userData.user?.id ?? 'anon';
    const path = `${salidaId}/firma_despachante_${uid}_${Date.now()}.png`;
    const { error: upErr } = await this.supabase.client.storage
      .from('conduces')
      .upload(path, firma, { upsert: true, contentType: 'image/png' });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('conduce_firmar_despachante', {
      p_salida_id: salidaId,
      p_firma_path: path,
    });
    if (error) throw new Error(error.message);
    this.catalog.invalidatePrefix('mis_confirmaciones');
  }

  /** AK1 — detalle completo de una confirmación (items, quién entregó/confirmó,
   *  cuándo, fotos y firmas). Firma las rutas de foto/firma (bucket conduces). */
  async confirmacionDetalle(salidaId: string): Promise<ConfirmacionDetalle> {
    const { data, error } = await this.supabase.client.rpc('confirmacion_detalle', { p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as ConfirmacionDetalle;
    // Firmar fotos/firmas para mostrarlas (bucket 'conduces', best-effort).
    d.entrega_foto_url = await this.signConduce(d.entrega_foto_path);
    d.recepcion_foto_url = await this.signConduce(d.recepcion_foto_path);
    for (const fm of d.firmas ?? []) fm.firma_url = await this.signConduce(fm.firma_path);
    for (const cf of d.confirmaciones ?? []) {
      cf.fotos_url = [];
      for (const p of cf.fotos ?? []) {
        const u = await this.signConduce(p);
        if (u) cf.fotos_url.push(u);
      }
    }
    return d;
  }

  /**
   * AL9/AL13/AL4 — detalle completo de un conduce (numero derivado, items con
   * nombre/cant/unidad, PORTADOR actual, fotos, firmas, historial de transferencias).
   * Fuente única para abrir desde cualquier listado y para "Ver conduce" (PDF).
   * Firma las fotos/firmas (bucket conduces) para mostrarlas. Requiere red.
   */
  async conduceDetalleApp(salidaId: string): Promise<ConduceDetalle> {
    const { data, error } = await this.supabase.client.rpc('conduce_detalle_app', { p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as ConduceDetalle;
    d.items ??= [];
    d.items_libres ??= []; // AU4
    d.firmas ??= [];
    d.transferencias ??= [];
    d.entrega_foto_url = await this.signConduce(d.entrega_foto_path);
    d.recepcion_foto_url = await this.signConduce(d.recepcion_foto_path);
    for (const fm of d.firmas) fm.firma_url = await this.signConduce(fm.firma_path);
    return d;
  }

  /**
   * AT16 — usuarios elegibles como RECEPTOR del conduce en la obra destino
   * (misma matriz que decide quién puede confirmar: responsables de la obra +
   * roles elevados). Online best-effort.
   */
  async receptoresDisponibles(proyectoId: string | null, bodegaId: string | null): Promise<ReceptorDisponible[]> {
    const { data, error } = await this.supabase.client.rpc('receptores_disponibles', {
      p_proyecto_id: proyectoId,
      p_bodega_id: bodegaId,
    });
    if (error) throw new Error(error.message);
    return (data as ReceptorDisponible[]) ?? [];
  }

  /**
   * AT10 — marca/desmarca un conduce como dato de PRUEBA (solo admin, online).
   * RPC genérico `marcar_movimiento_inventario_prueba('salidas_inventario', id,
   * valor)`. Un conduce de prueba no suma al inventario/KPIs, no notifica y queda
   * invisible salvo con el toggle "mostrar datos de prueba" del admin.
   */
  async marcarConducePrueba(salidaId: string, esPrueba: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_movimiento_inventario_prueba', {
      p_tabla: 'salidas_inventario',
      p_id: salidaId,
      p_valor: esPrueba,
    });
    if (error) throw new Error(error.message);
    void this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
    void this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    this.catalog.invalidatePrefix('mis_confirmaciones');
  }

  /** AL10 — almacenes centrales elegibles como destino (Bodega Central primero). */
  async almacenesDestino(): Promise<AlmacenDestino[]> {
    const data = await this.catalog.refresh<AlmacenDestino[]>('almacenes_destino', async () => {
      const { data, error } = await this.supabase.client.rpc('almacenes_destino');
      if (error) throw new Error(error.message);
      return (data as AlmacenDestino[]) ?? [];
    });
    return data ?? [];
  }

  /** Firma una ruta de storage del bucket de conduces (best-effort → null). */
  private async signConduce(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from('conduces').createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /**
   * AJ8 — el RECEPTOR confirma la entrega DESDE SU dispositivo: foto + firma
   * OBLIGATORIAS (server-side impide que confirme quien entregó). Genera la entrada
   * de inventario y avisa al chofer. Offline-safe por outbox.
   */
  async conduceConfirmarReceptor(input: {
    salidaId: string;
    foto: Blob | null; // BD2 — obligatoria pero NO bloqueante (si falta, exige nota)
    firma: Blob;
    checklist?: { llego_todo: boolean } | null;
    items?: { detalle_id: string; cantidad_recibida: number }[] | null;
    notas?: string | null;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = [
      { id: crypto.randomUUID(), bucket: 'conduces', path: `${input.salidaId}/${id}-conf-firma.png`, slot: 'conf_firma', blob: input.firma },
    ];
    if (input.foto) {
      fotos.unshift({ id: crypto.randomUUID(), bucket: 'conduces', path: `${input.salidaId}/${id}-conf-foto.jpg`, slot: 'conf_foto', blob: input.foto });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_confirmar',
      capturado_en: new Date().toISOString(),
      payload: {
        salida_id: input.salidaId,
        checklist: input.checklist ?? null,
        items: input.items ?? null,
        notas: input.notas ?? null,
      },
      fotos,
      resumen: { tipo: 'conduce_confirmar', salida_id: input.salidaId },
    });
  }

  // ─── AH5 — Transferencia de responsabilidad de conduces entre choferes ──────

  /** Choferes activos a los que se puede transferir. `choferes_activos` (AH5c) es
   *  accesible a cualquier chofer (choferes_estado solo lo ve flota-elevado). */
  async choferesParaTransferir(): Promise<{ id: string; label: string }[]> {
    const { data, error } = await this.supabase.client.rpc('choferes_activos');
    if (error) return [];
    return ((data ?? []) as { conductor_id: string; nombre: string }[])
      .filter((c) => c.conductor_id)
      .map((c) => ({ id: c.conductor_id, label: c.nombre }));
  }

  /** Ofertas de transferencia ABIERTAS dirigidas a mí (inbox del receptor). */
  async misTransferenciasPendientes(): Promise<ConduceTransferencia[]> {
    const r = await this.catalog.refresh('mis_transferencias', async () => {
      const { data, error } = await this.supabase.client.rpc('mis_transferencias_conduce');
      if (error) throw error;
      return (data ?? []) as ConduceTransferencia[];
    });
    return r ?? [];
  }

  /** Historial de transferencias de un conduce (trazabilidad en el detalle). */
  async transferenciasDeConduce(salidaId: string): Promise<ConduceTransferenciaHist[]> {
    const { data, error } = await this.supabase.client.rpc('transferencias_de_conduce', {
      p_salida_id: salidaId,
    });
    if (error) return [];
    return (data ?? []) as ConduceTransferenciaHist[];
  }

  /**
   * AH5 — el responsable actual OFRECE el conduce a otro chofer. Acción online
   * (coordina a dos personas; no tiene sentido offline). El servidor valida que
   * solo el chofer responsable (o flota) pueda ofrecer.
   */
  async ofrecerTransferencia(salidaId: string, aConductorId: string, notas: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('ofrecer_transferencia_conduce', {
      p_salida_id: salidaId,
      p_a_conductor_id: aConductorId,
      p_notas: notas,
    });
    if (error) throwSyncError(error);
    await this.catalog.invalidate('mis_transferencias').catch(() => {});
  }

  /**
   * AH5 — el receptor ACEPTA la transferencia con foto + firma (evidencia
   * obligatoria server-side, AH6/AH7). Offline-safe por outbox: sube foto+firma y
   * llama aceptar_transferencia_conduce (reasigna el conduce y su ruta al nuevo chofer).
   */
  async aceptarTransferencia(transferenciaId: string, foto: Blob, firma: Blob): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_transf_aceptar',
      capturado_en,
      payload: { id, transferencia_id: transferenciaId },
      fotos: [
        { id: crypto.randomUUID(), bucket: 'conduces', path: `transferencias/${transferenciaId}/${id}-foto.jpg`, slot: 'transf_foto', blob: foto },
        { id: crypto.randomUUID(), bucket: 'conduces', path: `transferencias/${transferenciaId}/${id}-firma.png`, slot: 'transf_firma', blob: firma },
      ],
      resumen: { tipo: 'conduce_transf_aceptar', transferencia_id: transferenciaId, capturado_en },
    });
    await this.catalog.invalidate('mis_transferencias').catch(() => {});
  }

  /** AH5 — el receptor rechaza (o el emisor/flota cancela) la oferta. Online. */
  async rechazarTransferencia(transferenciaId: string, motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_transferencia_conduce', {
      p_transferencia_id: transferenciaId,
      p_motivo: motivo,
    });
    if (error) throwSyncError(error);
    await this.catalog.invalidate('mis_transferencias').catch(() => {});
  }

  /**
   * AU4 — tras crear el conduce, adjunta los materiales NO catalogados (nota libre)
   * vía `agregar_items_libres_conduce` (dispara la alerta al admin/inventario). Se
   * corre DENTRO del mismo handler del outbox (misma op) para ser offline-safe.
   * Idempotente: si el conduce ya tiene items libres (reintento del handler tras un
   * fallo posterior), no vuelve a insertarlos ni a re-alertar.
   */
  /** AT4 — si el conduce se creó con ayudante, súmale la actividad (best-effort). */
  private async marcarAyudanteConduce(payload: Record<string, unknown>, salidaId: string): Promise<void> {
    const ayudanteId = payload['ayudante_id'] as string | null | undefined;
    if (ayudanteId && salidaId) await this.ayudantes.marcar('conduce', salidaId, ayudanteId);
  }

  /**
   * AT16 — si se eligió un receptor, dirige la confirmación a esa persona
   * (`asignar_firma_pendiente`: setea `firma_pendiente_usuario_id`, que alimenta
   * la matriz `confirmadores_de_conduce`). Best-effort: cualquier autorizado de la
   * obra puede confirmar igual; el elegido solo recibe la notificación dirigida.
   */
  private async dirigirReceptor(payload: Record<string, unknown>, salidaId: string): Promise<void> {
    const receptorId = payload['receptor_usuario_id'] as string | null | undefined;
    if (!receptorId || !salidaId) return;
    try {
      await this.supabase.client.rpc('asignar_firma_pendiente', {
        p_salida_id: salidaId,
        p_usuario_id: receptorId,
        p_nombre: (payload['receptor_nombre'] as string | null) ?? null,
      });
    } catch {
      /* best-effort: el conduce ya existe y cualquier autorizado puede confirmar */
    }
  }

  private async agregarItemsLibresSiHay(salidaId: string, payload: Record<string, unknown>): Promise<void> {
    const libres = (payload['items_libres'] as ItemLibre[] | undefined) ?? [];
    if (!salidaId || !libres.length) return;
    const { data: yaHay } = await this.supabase.client
      .from('salida_items_libres')
      .select('id')
      .eq('salida_id', salidaId)
      .limit(1);
    if (yaHay && yaHay.length) return; // ya adjuntados (reintento idempotente)
    const { error } = await this.supabase.client.rpc('agregar_items_libres_conduce', {
      p_salida_id: salidaId,
      p_items: libres,
    });
    if (error) throwSyncError(error);
  }

  /** BG1 §4 — ¿el error es "ya tiene una recepción confirmada"? (idempotencia: el
   *  primer intento sí escribió; un reintento tras perder el ack debe contar como
   *  éxito, no como fallo atascado). */
  private esRecepcionYaConfirmada(error: unknown): boolean {
    const msg = (error as { message?: string })?.message ?? String(error);
    return /ya tiene.*recepci[oó]n confirmada|recepci[oó]n ya (fue )?confirmada|ya (fue )?confirmad[ao]/i.test(msg);
  }

  private registerHandler(): void {
    // AQ10 — eliminar/anular conduce (soft-delete server-side; repone stock + cancela ruta).
    this.sync.register('conduce_eliminar', async (payload) => {
      const { error } = await this.supabase.client.rpc('anular_conduce', {
        p_salida_id: payload['salida_id'],
        p_motivo: payload['motivo'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
      await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
    });

    this.sync.register('crear_ruta', async (payload, photoPaths) => {
      const rutaId = payload['id'] as string;
      const conductorId = (payload['conductor_id'] as string | null) ?? null;
      const tipo = (payload['tipo'] as string) ?? 'material';

      // AC13 — paradas intermedias (estilo Uber), en orden.
      const paradas = (payload['paradas'] as RutaParadaCaptura[] | undefined) ?? [];
      const p_paradas = paradas
        .filter((p) => p.ubicacion?.trim())
        .map((p, i) => ({
          orden: i + 1,
          ubicacion: p.ubicacion,
          lat: p.lat,
          lng: p.lng,
          notas: p.notas,
          proyecto_id: p.proyectoId,
        }));

      if (conductorId == null) {
        // AD6 — el chofer se AUTO-asigna la ruta → RPC de alcance limitado que
        // además fija el `tipo` (material|personal|traslado) y setea las paradas.
        const { error } = await this.supabase.client.rpc('chofer_crear_ruta', {
          p_id: rutaId,
          p_tipo: tipo,
          p_fecha: payload['fecha'],
          p_origen: payload['origen'],
          p_destino: payload['destino'],
          p_vehiculo_id: payload['vehiculo_id'],
          p_destino_proyecto_id: payload['destino_proyecto_id'] ?? null,
          p_notas: payload['notas'] ?? null,
          p_paradas: p_paradas,
        });
        if (error) throwSyncError(error);
      } else {
        // S16 — jefe de flota asigna la ruta a un conductor (dispara la notificación).
        const { error } = await this.supabase.client.rpc('crear_ruta_app', {
          p_id: rutaId,
          p_vehiculo_id: payload['vehiculo_id'],
          p_conductor_id: conductorId,
          p_origen: payload['origen'],
          p_destino: payload['destino'],
          p_fecha: payload['fecha'],
          p_km_estimado: payload['km_estimado'] ?? null,
          p_notas: payload['notas'] ?? null,
          p_destino_proyecto_id: payload['destino_proyecto_id'] ?? null,
          p_destino_lat: payload['destino_lat'] ?? null,
          p_destino_lng: payload['destino_lng'] ?? null,
          p_capturado_en: payload['capturado_en'],
          p_origen_lat: payload['origen_lat'] ?? null,
          p_origen_lng: payload['origen_lng'] ?? null,
        });
        if (error) throwSyncError(error);

        // set_ruta_paradas reemplaza las paradas (idempotente ante reintentos).
        if (p_paradas.length) {
          const { error: ePar } = await this.supabase.client.rpc('set_ruta_paradas', {
            p_ruta_id: rutaId,
            p_paradas: p_paradas,
          });
          if (ePar) throwSyncError(ePar);
        }
      }

      // AT4 — sumarle la ruta al ayudante (best-effort; id de la ruta = client UUID).
      const ayudanteId = payload['ayudante_id'] as string | null | undefined;
      if (ayudanteId) await this.ayudantes.marcar('ruta', rutaId, ayudanteId);

      // AC6 — fotos de evidencia inicial → ruta_fotos (momento='inicio'). Insert
      // directo (la RLS permite al creador). Guarda de idempotencia: si ya hay
      // fotos de inicio (reintento del outbox tras éxito parcial), no re-inserta.
      const nFotos = (payload['n_fotos'] as number | undefined) ?? 0;
      if (nFotos > 0) {
        const rows = [];
        for (let i = 0; i < nFotos; i++) {
          const path = photoPaths[`foto_${i}`];
          if (path) rows.push({ ruta_id: rutaId, momento: 'inicio', storage_path: path, orden: i + 1 });
        }
        if (rows.length) {
          const { data: yaHay } = await this.supabase.client
            .from('ruta_fotos')
            .select('id')
            .eq('ruta_id', rutaId)
            .eq('momento', 'inicio')
            .limit(1);
          if (!yaHay?.length) {
            const { error: eFoto } = await this.supabase.client.from('ruta_fotos').insert(rows);
            if (eFoto) throwSyncError(eFoto);
          }
        }
      }

      // Z23 — registrar las notas de voz de la ruta (idempotente por path).
      await this.audioNotas.commit('ruta', rutaId, payload['audios'] as AudioNotaMeta[] | undefined, photoPaths);

      // AG15 — si la ruta nace de una tarea vinculada, enlázala (la tarea se
      // completa sola cuando la ruta llegue a 'completada'). Idempotente.
      const tareaVinc = payload['tarea_vinculada'] as string | null;
      if (tareaVinc) {
        const { error: eV } = await this.supabase.client.rpc('vincular_tarea_entidad', {
          p_tarea_id: tareaVinc,
          p_tipo: 'ruta',
          p_entity_id: rutaId,
        });
        if (eV) throwSyncError(eV);
      }

      // AY11 — si la ruta nace de PLANIFICAR una solicitud de movimiento, vincúlala
      // (la solicitud pasa a 'planificada' + toma el chofer de la ruta). Idempotente.
      const solicitudVinc = payload['solicitud_id'] as string | null;
      if (solicitudVinc) {
        const { error: eS } = await this.supabase.client.rpc('vincular_solicitud_ruta', {
          p_solicitud_id: solicitudVinc,
          p_ruta_id: rutaId,
        });
        if (eS) throwSyncError(eS);
      }
    });

    // AE5 — avanzar una parada (en_camino/entregada/omitida). Offline-first; el RPC
    // es idempotente (fija el estado).
    this.sync.register('parada_avanzar', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('avanzar_parada', {
        p_parada_id: payload['parada_id'],
        p_estado: payload['estado'],
        p_foto_path: photoPaths['parada_foto'] ?? null,
        p_firma_path: photoPaths['parada_firma'] ?? null,
        p_entregado_a: payload['entregado_a'] ?? null,
        p_notas: payload['notas'] ?? null,
        p_at: payload['at'] ?? null, // AH8 — tap-time
        p_lat: payload['lat'] ?? null, // AH8 — ubicación de completado
        p_lng: payload['lng'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // AE7 — iniciar/completar/cancelar una ruta. Offline-first; el RPC fija el
    // estado con sanity-check → idempotente ante reintentos.
    this.sync.register('ruta_estado', async (payload) => {
      const { error } = await this.supabase.client.rpc('marcar_ruta_estado', {
        p_ruta_id: payload['ruta_id'],
        p_estado: payload['estado'],
        p_at: payload['at'],
      });
      if (error) throwSyncError(error);
    });

    // AF25 — RUTA VIVA: agregar una parada a mitad de ruta. Offline-first.
    this.sync.register('ruta_agregar_parada', async (payload) => {
      const { error } = await this.supabase.client.rpc('agregar_parada_ruta', {
        p_ruta_id: payload['ruta_id'],
        p_ubicacion: payload['ubicacion'],
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_lat: payload['lat'] ?? null,
        p_lng: payload['lng'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // AF25 — RUTA VIVA: cambiar el destino (cancelar = cambiar destino, se trackea).
    this.sync.register('ruta_cambiar_destino', async (payload) => {
      const { error } = await this.supabase.client.rpc('cambiar_destino_ruta', {
        p_ruta_id: payload['ruta_id'],
        p_destino: payload['destino'],
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_lat: payload['lat'] ?? null,
        p_lng: payload['lng'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // AE5 — atar un conduce a una parada. Offline-first; idempotente.
    this.sync.register('conduce_vincular_parada', async (payload) => {
      const { error } = await this.supabase.client.rpc('vincular_conduce_parada', {
        p_salida_id: payload['salida_id'],
        p_ruta_parada_id: payload['parada_id'],
      });
      if (error) throwSyncError(error);
    });

    // AE — el chofer genera un conduce (salida de material). El servidor valida el
    // stock; idempotente por UUID.
    this.sync.register('conduce_transportista', async (payload, photoPaths) => {
      const salidaId = payload['id'] as string;
      const { error } = await this.supabase.client.rpc('crear_conduce_transportista', {
        p_id: salidaId,
        p_fecha: payload['fecha'],
        p_bodega_id: payload['bodega_id'],
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_vehiculo_id: payload['vehiculo_id'] ?? null,
        p_ruta_id: payload['ruta_id'] ?? null,
        p_items: payload['items'],
      });
      if (error) throwSyncError(error);
      await this.marcarAyudanteConduce(payload, salidaId); // AT4
      // AF23.3 — sella la firma del emisor (quien entrega) al emitir. Idempotente
      // por (salida_id, rol). Best-effort verificado: el outbox reintenta si falla.
      const firmaEmisor = photoPaths['firma_emisor'];
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id ?? null;
      if (firmaEmisor) {
        const { error: eF } = await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'emisor',
          p_nombre: payload['emisor_nombre'] ?? 'Emisor',
          p_firma_path: firmaEmisor,
          // Si otra persona entrega, su firma no se atribuye al usuario actual.
          p_usuario_id: payload['emisor_es_otro'] ? null : uid,
        });
        if (eF) throwSyncError(eF);
      }
      // AH4 — segunda firma: el chofer que transporta. Idempotente por (salida, rol).
      const firmaTransportista = photoPaths['firma_transportista'];
      if (firmaTransportista) {
        const { error: eT } = await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'transportista',
          p_nombre: payload['transportista_nombre'] ?? payload['emisor_nombre'] ?? 'Chofer',
          p_firma_path: firmaTransportista,
          p_usuario_id: uid,
        });
        if (eT) throwSyncError(eT);
      }
      // AG15 — si el conduce nace de una tarea vinculada, enlázala a esta salida.
      // Se hace AQUÍ (post-éxito, salida ya existe) y es idempotente: cuando la
      // salida se marque 'entregado', el trigger completa la tarea sola y notifica
      // al asignador. crear_conduce_transportista es idempotente por p_id, así que
      // reintentar el handler tras un fallo de este link es seguro.
      const tareaVinc = payload['tarea_vinculada'] as string | null;
      if (tareaVinc) {
        const { error: eV } = await this.supabase.client.rpc('vincular_tarea_entidad', {
          p_tarea_id: tareaVinc,
          p_tipo: 'conduce',
          p_entity_id: salidaId,
        });
        if (eV) throwSyncError(eV);
      }
      // AE7 — la salida bajó el stock de la bodega de origen → invalida el preview
      // de existencias cacheado (como la devolución) para no mostrar un stock viejo.
      await this.catalog.invalidatePrefix('existencias_');
    });

    // AI2 — conduce simplificado: un solo RPC sella despachante + foto de recepción
    // + firmas (chofer transportista + despachante emisor). Idempotente por UUID.
    this.sync.register('conduce_simple', async (payload, photoPaths) => {
      const salidaId = payload['id'] as string;
      const { error } = await this.supabase.client.rpc('crear_conduce_simple', {
        p_id: salidaId,
        p_fecha: payload['fecha'],
        p_bodega_id: payload['bodega_id'] ?? null,
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_vehiculo_id: payload['vehiculo_id'] ?? null,
        p_ruta_id: null,
        p_items: payload['items'],
        p_despachante_nombre: payload['despachante_nombre'] ?? null,
        p_despachante_usuario_id: payload['despachante_usuario_id'] ?? null,
        p_despachante_empleado_id: payload['despachante_empleado_id'] ?? null,
        p_carga_foto_path: photoPaths['carga'] ?? null,
        p_firma_chofer_path: photoPaths['firma_chofer'] ?? null,
        p_firma_despachante_path: photoPaths['firma_despachante'] ?? null,
        p_destino_almacen_id: payload['destino_almacen_id'] ?? null, // AL10 (15-arg)
      });
      if (error) throwSyncError(error);
      await this.marcarAyudanteConduce(payload, salidaId); // AT4
      await this.dirigirReceptor(payload, salidaId); // AT16
      // AG15 — enlaza la tarea vinculada (idempotente; se autocompleta al entregar).
      const tareaVinc = payload['tarea_vinculada'] as string | null;
      if (tareaVinc) {
        const { error: eV } = await this.supabase.client.rpc('vincular_tarea_entidad', {
          p_tarea_id: tareaVinc,
          p_tipo: 'conduce',
          p_entity_id: salidaId,
        });
        if (eV) throwSyncError(eV);
      }
      await this.agregarItemsLibresSiHay(salidaId, payload); // AU4
      // BA/FASE 2 — si el conduce es un despacho, enlázalo a la requisición.
      const reqId = payload['origen_requisicion_id'] as string | null;
      if (reqId) {
        const { error: eR } = await this.supabase.client.rpc('despacho_marcar', {
          p_salida_id: salidaId,
          p_requisicion_id: reqId,
        });
        if (eR) throwSyncError(eR);
      }
      await this.catalog.invalidatePrefix('existencias_');
      // QA-6 — el conduce ya existe en el servidor → refresca "Pendiente entrega".
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    });

    // BA/Transporte v3 (FASE 1) — conduce externo (un proveedor transporta). El
    // servidor registra el viaje al proveedor y la bandeja de «Otros» al emitir.
    this.sync.register('conduce_externo', async (payload, photoPaths) => {
      if (!photoPaths['placa']) {
        throwSyncError(new Error('Falta la foto de la placa del camión.'));
      }
      const { error } = await this.supabase.client.rpc('crear_conduce_externo', {
        p_transporta_proveedor_id: payload['transporta_proveedor_id'] ?? null,
        p_transporta_texto: payload['transporta_texto'] ?? null,
        p_placa_foto_path: photoPaths['placa'],
        p_carga_foto_path: photoPaths['carga'] ?? null,
        p_material_descripcion: payload['material_descripcion'] ?? null,
        p_items: payload['items'] ?? null,
        p_origen: payload['origen'] ?? null,
        p_origen_lat: payload['origen_lat'] ?? null,
        p_origen_lng: payload['origen_lng'] ?? null,
        p_origen_proyecto_id: payload['origen_proyecto_id'] ?? null,
        p_origen_bodega_id: payload['origen_bodega_id'] ?? null,
        p_destino: payload['destino'] ?? null,
        p_destino_lat: payload['destino_lat'] ?? null,
        p_destino_lng: payload['destino_lng'] ?? null,
        p_destino_proyecto_id: payload['destino_proyecto_id'] ?? null,
        p_destino_bodega_id: payload['destino_bodega_id'] ?? null,
        p_emisor_firma_path: null,
        p_origen_requisicion_id: payload['origen_requisicion_id'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // AM1 — devolución a suplidor: RPC dedicada con ORIGEN obligatorio (blinda el
    // bug del bodega_id null). Errores estructurados (DR451) → mensaje accionable.
    this.sync.register('conduce_devolucion_suplidor', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('crear_conduce_devolucion_suplidor', {
        p_id: payload['id'],
        p_fecha: payload['fecha'],
        p_bodega_origen_id: payload['bodega_origen_id'],
        p_proyecto_origen_id: payload['proyecto_origen_id'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_vehiculo_id: payload['vehiculo_id'] ?? null,
        p_items: payload['items'],
        p_despachante_nombre: payload['despachante_nombre'] ?? null,
        p_despachante_usuario_id: payload['despachante_usuario_id'] ?? null,
        p_despachante_empleado_id: payload['despachante_empleado_id'] ?? null,
        p_carga_foto_path: photoPaths['carga'] ?? null,
        p_firma_chofer_path: photoPaths['firma_chofer'] ?? null,
        p_firma_despachante_path: photoPaths['firma_despachante'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.marcarAyudanteConduce(payload, payload['id'] as string); // AT4
      await this.agregarItemsLibresSiHay(payload['id'] as string, payload); // AU4
      await this.catalog.invalidatePrefix('existencias_');
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    });

    // QA-32: handler kept for backward-compat with any queued conduce_entrega ops
    // (legacy delivery capture con firma de receptor). El flujo AJ8 ya no lo usa.
    this.sync.register('conduce_entrega', async (payload, photoPaths) => {
      const salidaId = payload['salida_id'] as string;
      const firmaReceptor = photoPaths['firma']; // AE — puede faltar (receptor ausente)
      const { error } = await this.supabase.client.rpc('entregar_conduce', {
        p_salida_id: salidaId,
        p_items: payload['items'],
        p_receptor: payload['receptor'],
        p_firma_url: firmaReceptor ?? null,
        p_foto_url: photoPaths['entrega'],
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);

      // AC7 — persistir las firmas en salida_firmas (emisor + receptor). El RPC es
      // idempotente por (salida_id, rol). Best-effort: si falla no revierte la entrega.
      // Los RPCs de firma/enrutamiento SÍ se verifican (antifraude): si fallan, el
      // outbox reintenta (todos idempotentes). Antes eran best-effort y una firma o
      // el enrutamiento del pendiente se podía perder en silencio.
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id ?? null;
      const firmaEmisor = photoPaths['firma_emisor'];
      if (firmaEmisor) {
        const { error: eE } = await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'emisor',
          p_nombre: payload['emisor_nombre'] ?? 'Emisor',
          p_firma_path: firmaEmisor,
          p_usuario_id: uid,
        });
        if (eE) throwSyncError(eE);
      }
      if (firmaReceptor) {
        const { error: eR } = await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'receptor',
          p_nombre: payload['receptor'] ?? 'Receptor',
          p_firma_path: firmaReceptor,
        });
        if (eR) throwSyncError(eR);
      } else if (payload['receptor_usuario_id']) {
        // AE — receptor ausente: su firma queda PENDIENTE y se le enruta el aviso.
        const { error: eP } = await this.supabase.client.rpc('asignar_firma_pendiente', {
          p_salida_id: salidaId,
          p_usuario_id: payload['receptor_usuario_id'],
          p_nombre: payload['receptor'] ?? null,
        });
        if (eP) throwSyncError(eP);
      }
    });

    // AJ8 — el chofer avanza el estado de su conduce (en_transito / entregando).
    this.sync.register('conduce_estado_op', async (payload) => {
      const { error } = await this.supabase.client.rpc('conduce_actualizar_estado', {
        p_salida_id: payload['salida_id'],
        p_estado: payload['estado'],
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
      // QA-6 — el estado del conduce cambió → refresca "Pendiente entrega".
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
    });

    // AJ8 — el chofer marca ENTREGADO con foto obligatoria (sin firma del receptor).
    // El RPC notifica a los receptores del destino para que confirmen en SU teléfono.
    this.sync.register('conduce_entregado', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('conduce_marcar_entregado', {
        p_salida_id: payload['salida_id'],
        p_foto_path: photoPaths['entrega'],
        p_items: payload['items'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
      // QA-6 — sale de "Pendiente entrega" y entra a "Por confirmar" (receptor).
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
      await this.catalog.invalidate(CATALOG_POR_CONFIRMAR).catch(() => {});
    });

    // AJ8 — el RECEPTOR confirma la entrega desde su dispositivo (foto + firma).
    // Server-side impide que confirme quien entregó; genera la entrada de inventario.
    this.sync.register('conduce_confirmar', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('conduce_confirmar_receptor', {
        p_salida_id: payload['salida_id'],
        p_foto_path: photoPaths['conf_foto'] ?? null, // BD2 — puede faltar (con nota)
        p_firma_path: photoPaths['conf_firma'],
        p_checklist: payload['checklist'] ?? null,
        p_items: payload['items'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      // BG1 §4 (idempotencia) — si el primer intento SÍ escribió pero se perdió el
      // ack (red), un reintento choca con "ya tiene una recepción confirmada": eso
      // es ÉXITO, no un fallo (el conduce ya quedó recibido). Se trata como OK para
      // que la op salga del outbox en vez de quedar atascada.
      if (error && !this.esRecepcionYaConfirmada(error)) throwSyncError(error);
      await this.catalog.invalidatePrefix('existencias_').catch(() => {});
      // QA-6 — confirmada → sale de "Por confirmar".
      await this.catalog.invalidate(CATALOG_POR_CONFIRMAR).catch(() => {});
    });

    // AH5 — el receptor acepta una transferencia de conduce (foto + firma). El RPC
    // reasigna el conduce y su ruta al nuevo chofer; exige foto+firma (AH6/AH7).
    // Idempotente por transferencia (aceptar dos veces devuelve el mismo id).
    this.sync.register('conduce_transf_aceptar', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('aceptar_transferencia_conduce', {
        p_transferencia_id: payload['transferencia_id'],
        p_foto_path: photoPaths['transf_foto'],
        p_firma_path: photoPaths['transf_firma'],
      });
      if (error) throwSyncError(error);
      // AM4 — el conduce y su ruta cambiaron de dueño → refrescar TODOS mis listados
      // vivos. Incluye "Pendiente entrega" (el receptor debe verlo YA; el emisor deja
      // de verlo): antes se omitía y la bandeja quedaba inconsistente hasta un
      // foreground/pull manual.
      await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
      await this.catalog.invalidate(CATALOG_RUTAS).catch(() => {});
      await this.catalog.invalidate(CATALOG_PENDIENTES_ENTREGA).catch(() => {});
      await this.catalog.invalidate('mis_transferencias').catch(() => {});
    });
  }
}
