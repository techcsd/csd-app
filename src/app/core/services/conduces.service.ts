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
  /** AC7 — firma de quien RECIBE (receptor). */
  firma: Blob;
  // AC7 — firma de quien ENTREGA (emisor: chofer/almacén). Ambas obligatorias.
  emisorNombre: string;
  firmaEmisor: Blob;
}

/** New-route capture the crear-ruta wizard hands to crearRuta(). */
export interface RutaCaptura {
  vehiculoId: string;
  /** S16 — conductor asignado (el jefe de flota lo elige; dispara la notificación). */
  conductorId: string | null;
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
   */
  async marcarRuta(
    rutaId: string,
    estado: 'en_curso' | 'completada' | 'cancelada',
    at: string = new Date().toISOString(),
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_ruta_estado', {
      p_ruta_id: rutaId,
      p_estado: estado,
      p_at: at,
    });
    if (error) throw new Error(error.message);
    void this.misRutas();
  }

  /** Queue a conduce delivery (photo + receiver + signature). Offline-safe. */
  async entregarConduce(input: ConduceEntregaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

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
      },
      fotos: [
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-entrega.jpg`,
          slot: 'entrega',
          blob: input.fotoEntrega,
        },
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-firma.png`,
          slot: 'firma',
          blob: input.firma,
        },
        // AC7 — firma del emisor (quien entrega).
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-firma-emisor.png`,
          slot: 'firma_emisor',
          blob: input.firmaEmisor,
        },
      ],
      resumen: { salida_id: input.salidaId, receptor: input.receptor, capturado_en },
    });

    void this.misConduces();
  }

  private registerHandler(): void {
    this.sync.register('crear_ruta', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('crear_ruta_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: payload['conductor_id'] ?? null, // S16 — conductor asignado
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

      const rutaId = payload['id'] as string;

      // AC13 — paradas intermedias (estilo Uber), en orden. set_ruta_paradas
      // reemplaza las paradas de la ruta (idempotente ante reintentos del outbox).
      const paradas = (payload['paradas'] as RutaParadaCaptura[] | undefined) ?? [];
      if (paradas.length) {
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
        const { error: ePar } = await this.supabase.client.rpc('set_ruta_paradas', {
          p_ruta_id: rutaId,
          p_paradas: p_paradas,
        });
        if (ePar) throwSyncError(ePar);
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

    this.sync.register('conduce_entrega', async (payload, photoPaths) => {
      const salidaId = payload['salida_id'] as string;
      const { error } = await this.supabase.client.rpc('entregar_conduce', {
        p_salida_id: salidaId,
        p_items: payload['items'],
        p_receptor: payload['receptor'],
        p_firma_url: photoPaths['firma'],
        p_foto_url: photoPaths['entrega'],
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);

      // AC7 — persistir AMBAS firmas en salida_firmas (emisor + receptor). El RPC
      // es idempotente por (salida_id, rol), así que un reintento del outbox no
      // duplica. Best-effort: si falla no revierte la entrega (ya registrada).
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id ?? null;
      const firmaEmisor = photoPaths['firma_emisor'];
      const firmaReceptor = photoPaths['firma'];
      if (firmaEmisor) {
        await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'emisor',
          p_nombre: payload['emisor_nombre'] ?? 'Emisor',
          p_firma_path: firmaEmisor,
          p_usuario_id: uid,
        });
      }
      if (firmaReceptor) {
        await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'receptor',
          p_nombre: payload['receptor'] ?? 'Receptor',
          p_firma_path: firmaReceptor,
        });
      }
    });
  }
}
