import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { LocalStore } from './local-store.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';
import { Conduce, RutaHoy } from '../models/transporte.model';
import { Proyecto } from '../models/bitacora.model';

const CATALOG_CONDUCES = 'mis_conduces';
const CATALOG_RUTAS = 'mis_rutas';
const CATALOG_PROYECTOS = 'proyectos';
/** Y3 — ids de rutas planificadas ya vistas (para el badge de "rutas nuevas"). */
const VISTAS_KEY = 'conduces_rutas_vistas';

/** Delivery capture the conduce screen hands to entregarConduce(). */
export interface ConduceEntregaCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  receptor: string;
  notas: string | null;
  fotoEntrega: Blob;
  /** AC7 — firma de quien RECIBE (receptor). null = receptor ausente (pendiente). */
  firma: Blob | null;
  // AC7 — firma de quien ENTREGA (emisor: chofer/almacén). Obligatoria.
  emisorNombre: string;
  firmaEmisor: Blob;
  /** AE — si el receptor NO firmó ahora, a quién se le asigna la firma pendiente. */
  receptorUsuarioId?: string | null;
}

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
  km_estimado: number | null;
  km_real: number | null;
  duracion_min: number | null;
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
  conductor_nombre: string | null;
  fecha: string;
  iniciada_at: string | null;
  paradas_total: number;
  paradas_entregadas: number;
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
        };
      },
    );
    return data ?? { ruta: null, trayecto: [], paradas: [], conduces: [] };
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
   * AF29 — historial de conduces (matriz de visibilidad server-side). Online-first
   * con cache razonable (histórico no necesita offline completo). Los filtros
   * (fecha/obra) van al servidor; el filtro por fase se aplica en la UI.
   */
  async misConducesHistorial(
    opts: { desde?: string | null; hasta?: string | null; proyectoId?: string | null } = {},
  ): Promise<ConduceHistorial[]> {
    const key = `conduces_hist:${opts.desde ?? ''}:${opts.hasta ?? ''}:${opts.proyectoId ?? ''}`;
    const data = await this.catalog.refresh<ConduceHistorial[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_historial', {
        p_desde: opts.desde ?? null,
        p_hasta: opts.hasta ?? null,
        p_proyecto_id: opts.proyectoId ?? null,
        p_limite: 200,
      });
      if (error) throw new Error(error.message);
      return (data as ConduceHistorial[]) ?? [];
    });
    return data ?? [];
  }

  /** AI2 — universo del select "Despachante" (usuarios + empleados). Cacheado. */
  async despachantesDisponibles(): Promise<Despachante[]> {
    const data = await this.catalog.refresh<Despachante[]>('despachantes', async () => {
      const { data, error } = await this.supabase.client.rpc('despachantes_disponibles');
      if (error) throw new Error(error.message);
      return (data as Despachante[]) ?? [];
    });
    return data ?? [];
  }

  /** AI2 — conduces emitidos pendientes de entrega (para el menú Conduce). */
  async misConducesPendientesEntrega(): Promise<ConducePendienteEntrega[]> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega');
    if (error) throw new Error(error.message);
    return (data as ConducePendienteEntrega[]) ?? [];
  }

  /** AI2 — contador de conduces pendientes de entrega (badge). Best-effort. */
  async pendientesEntregaCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega_count');
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
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
    const id = crypto.randomUUID();
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
  async crearConduceSimple(input: ConduceSimpleCaptura): Promise<void> {
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
        tarea_vinculada: input.tareaVinculada ?? null,
      },
      fotos,
      resumen: { bodega_id: input.bodegaId, proyecto_id: input.proyectoId, capturado_en },
    });
    void this.misConduces();
  }

  /** Queue a conduce delivery (photo + receiver + signature). Offline-safe. */
  async entregarConduce(input: ConduceEntregaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = [
      { id: crypto.randomUUID(), bucket: 'conduces', path: `${input.salidaId}/${id}-entrega.jpg`, slot: 'entrega', blob: input.fotoEntrega },
      // AC7 — firma del emisor (quien entrega).
      { id: crypto.randomUUID(), bucket: 'conduces', path: `${input.salidaId}/${id}-firma-emisor.png`, slot: 'firma_emisor', blob: input.firmaEmisor },
    ];
    // AC7/AE — firma del receptor SOLO si está presente; si no, queda pendiente.
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `${input.salidaId}/${id}-firma.png`, slot: 'firma', blob: input.firma });
    }

    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_entrega',
      capturado_en,
      payload: {
        salida_id: input.salidaId,
        items: input.items,
        receptor: input.receptor,
        emisor_nombre: input.emisorNombre, // AC7
        notas: input.notas,
        receptor_usuario_id: input.receptorUsuarioId ?? null, // AE — firma pendiente
      },
      fotos,
      resumen: { salida_id: input.salidaId, receptor: input.receptor, capturado_en },
    });

    void this.misConduces();
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

  private registerHandler(): void {
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
      });
      if (error) throwSyncError(error);
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
      await this.catalog.invalidatePrefix('existencias_');
    });

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
      // El conduce y su ruta cambiaron de dueño → refrescar mis listados.
      await this.catalog.invalidate(CATALOG_CONDUCES).catch(() => {});
      await this.catalog.invalidate(CATALOG_RUTAS).catch(() => {});
      await this.catalog.invalidate('mis_transferencias').catch(() => {});
    });
  }
}
