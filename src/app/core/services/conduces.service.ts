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
}

/** AE — el chofer GENERA un conduce (salida de material) desde una bodega hacia
 *  una obra. Valida stock en el servidor (crear_conduce_transportista). */
export interface ConduceTransportistaCaptura {
  bodegaId: string;
  proyectoId: string | null;
  observaciones: string | null;
  items: { articulo_id: string; cantidad: number }[];
  vehiculoId?: string | null;
  rutaId?: string | null;
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

/** AE5 — detalle de ejecución de la ruta (ruta_detalle_transporte). */
export interface RutaDetalleTransporte {
  paradas: RutaParadaEjec[];
  conduces: RutaConduceEjec[];
}

/** Obra o almacén como destino, con sus coordenadas (U22). */
export interface LugarDestino {
  id: string;
  nombre: string;
  tipo: 'obra' | 'almacen';
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
        return { paradas: d.paradas ?? [], conduces: d.conduces ?? [] };
      },
    );
    return data ?? { paradas: [], conduces: [] };
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
    opts: { entregadoA?: string | null; notas?: string | null; foto?: Blob | null; firma?: Blob | null } = {},
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
      },
      fotos,
      resumen: { tipo: 'avanzar_parada', parada_id: paradaId, capturado_en },
    });
  }

  /** AE5 — fuerza el refetch del detalle de una ruta tras una mutación. */
  async invalidarRutaDetalle(rutaId: string): Promise<void> {
    await this.catalog.invalidate(`ruta_detalle_t:${rutaId}`);
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

  /** U22 — obras + almacenes con coordenadas, para elegir destino de la ruta. */
  async getLugaresDestino(): Promise<LugarDestino[]> {
    const data = await this.catalog.refresh<LugarDestino[]>('lugares_destino', async () => {
      const [obras, almacenes] = await Promise.all([
        this.supabase.client.from('proyectos').select('id, nombre, latitud, longitud').order('nombre'),
        this.supabase.client.from('bodegas').select('id, nombre, latitud, longitud').eq('activo', true).order('nombre'),
      ]);
      if (obras.error) throw new Error(obras.error.message);
      const lugares: LugarDestino[] = [];
      for (const o of (obras.data as Array<Record<string, unknown>>) ?? []) {
        lugares.push({
          id: o['id'] as string, nombre: o['nombre'] as string, tipo: 'obra',
          latitud: (o['latitud'] as number) ?? null, longitud: (o['longitud'] as number) ?? null,
        });
      }
      // bodegas puede no tener columnas geo en un entorno viejo → tolerante.
      for (const b of (almacenes.data as Array<Record<string, unknown>> | null) ?? []) {
        lugares.push({
          id: b['id'] as string, nombre: b['nombre'] as string, tipo: 'almacen',
          latitud: (b['latitud'] as number) ?? null, longitud: (b['longitud'] as number) ?? null,
        });
      }
      return lugares;
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
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_transportista',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_id: input.bodegaId,
        proyecto_id: input.proyectoId,
        observaciones: input.observaciones,
        vehiculo_id: input.vehiculoId ?? null,
        ruta_id: input.rutaId ?? null,
        items: input.items,
      },
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
    this.sync.register('conduce_transportista', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_conduce_transportista', {
        p_id: payload['id'],
        p_fecha: payload['fecha'],
        p_bodega_id: payload['bodega_id'],
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_vehiculo_id: payload['vehiculo_id'] ?? null,
        p_ruta_id: payload['ruta_id'] ?? null,
        p_items: payload['items'],
      });
      if (error) throwSyncError(error);
      // AE7 — la salida bajó el stock de la bodega de origen → invalida el preview
      // de existencias cacheado (como la devolución) para no mostrar un stock viejo.
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
  }
}
