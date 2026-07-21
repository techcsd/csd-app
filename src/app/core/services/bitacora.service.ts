import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  ActividadEntry,
  BitacoraFull,
  CatOrdenado,
  EquipoAlquilado,
  IncidenteTipo,
  Proyecto,
  ProyectoPartida,
  SUCESO_TIPO_POR_INCIDENTE,
} from '../models/bitacora.model';

const CATALOG_PROYECTOS = 'proyectos';
const BUCKET = 'sgc-bitacora';

export interface ParteDiarioCaptura {
  proyectoId: string;
  personalCarpinteria: number;
  personalAcero: number;
  trabajadoresCasa: number;
  otroPersonal: string | null;
  // W3 — paridad con la web (opcionales).
  bloqueEntrepiso: string | null;
  ingenieroResponsable: string | null;
  horaFinTrabajo: string | null;
  actividades: ActividadEntry[];
  // U12 — cada restricción lleva su descripción breve (obligatoria).
  restricciones: { tipo_restriccion: string; descripcion_otro: string | null }[];
  comentarios: string | null;
  fotos: Blob[];
  // R21/R22 — clima y migración (el clima NO es incidente).
  llovio: boolean | null;
  lluviaDetalle: string | null;
  huboMigracion: boolean | null;
  migracionObreros: string[] | null;
  // W2 — equipos alquilados en uso hoy.
  huboEquipos: boolean | null;
  equiposAlquilados: EquipoAlquilado[];
}

export interface IncidenteCaptura {
  proyectoId: string;
  tipo: IncidenteTipo;
  gravedad: string;
  lesionados: number;
  descripcion: string | null;
  // W3 — acciones/medidas tomadas + subcontratista (paridad con la web).
  acciones: string | null;
  subcontratista: string | null;
  // S13 — suceso elegido del catálogo ("¿qué pasó?").
  suceso: string | null;
  // S12 — campos del "incidente de equipo".
  equipoNombre: string | null;
  equipoAlquilado: boolean | null;
  equipoOperativo: boolean | null;
  fotos: Blob[];
  voz: Blob | null;
}

/**
 * Bitácora writes (parte diario / incidente) through the offline outbox,
 * committed by sgc.crear_bitacora_app. Photos upload to the existing
 * sgc-bitacora bucket. Proyectos are cached for offline obra selection.
 */
@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Admin-managed bitácora catalogs (estructuras/actividades/restricciones). */
  async getCatalogos(): Promise<{ estructuras: string[]; actividades: string[]; restricciones: string[] }> {
    const rows = await this.catalog.refresh<{ tipo: string; valor: string }[]>(
      'bitacora_catalogos',
      async () => {
        const { data, error } = await this.supabase.client
          .from('bitacora_catalogos')
          .select('tipo, valor')
          .eq('activo', true)
          .order('valor');
        if (error) throw new Error(error.message);
        return (data as { tipo: string; valor: string }[]) ?? [];
      },
    );
    const list = rows ?? [];
    const by = (t: string) => list.filter((r) => r.tipo === t).map((r) => r.valor);
    return { estructuras: by('estructura'), actividades: by('actividad'), restricciones: by('restriccion') };
  }

  /**
   * S2 — estructuras y actividades ya ordenadas por el servidor para esta obra:
   * orden de ejecución + las ~3 más usadas de la obra primero (`destacado`).
   * Cacheado por proyecto (offline). Si el RPC falla/no hay señal, degrada al
   * catálogo plano (getCatalogos) manteniendo el orden que traiga.
   */
  async getCatalogoOrdenado(
    proyectoId: string,
  ): Promise<{ estructuras: CatOrdenado[]; actividades: CatOrdenado[] }> {
    const key = `catalogo_ordenado_${proyectoId}`;
    const rows = await this.catalog.refresh<{ tipo: string; valor: string; destacado: boolean }[]>(
      key,
      async () => {
        const { data, error } = await this.supabase.client.rpc('catalogo_ordenado', {
          p_proyecto_id: proyectoId,
        });
        if (error) throw new Error(error.message);
        // El RPC ya devuelve las filas ordenadas (destacadas primero, luego orden).
        return ((data as { tipo: string; valor: string; activo: boolean; destacado: boolean }[]) ?? [])
          .filter((r) => r.activo !== false)
          .map((r) => ({ tipo: r.tipo, valor: r.valor, destacado: !!r.destacado }));
      },
    );
    const list = rows ?? [];
    if (list.length) {
      const by = (t: string): CatOrdenado[] =>
        list.filter((r) => r.tipo === t).map((r) => ({ valor: r.valor, destacado: r.destacado }));
      return { estructuras: by('estructura'), actividades: by('actividad') };
    }
    // Fallback: catálogo plano (sin ranking) → ninguno destacado.
    const plano = await this.getCatalogos();
    const wrap = (vals: string[]): CatOrdenado[] => vals.map((v) => ({ valor: v, destacado: false }));
    return { estructuras: wrap(plano.estructuras), actividades: wrap(plano.actividades) };
  }

  /**
   * S13 — sucesos probables ("¿qué pasó?") del catálogo, por tipo de incidente.
   * `tipo` es 'incidente'|'accidente'|'incidente_equipo'; lee las filas
   * suceso_* de bitacora_catalogos, cacheadas offline.
   */
  async getSucesos(tipo: IncidenteTipo): Promise<string[]> {
    const catTipo = SUCESO_TIPO_POR_INCIDENTE[tipo];
    const data = await this.catalog.refresh<string[]>(`sucesos_${catTipo}`, async () => {
      const { data, error } = await this.supabase.client
        .from('bitacora_catalogos')
        .select('valor, orden')
        .eq('tipo', catTipo)
        .eq('activo', true)
        .order('orden', { ascending: true })
        .order('valor', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as { valor: string }[]) ?? []).map((r) => r.valor);
    });
    return data ?? [];
  }

  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>(CATALOG_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre')
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  async enqueueParteDiario(input: ParteDiarioCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    // S3/S4 — el "sujeto" ahora vive por actividad (bloque). Para paridad con la
    // web/BD (columna de cabecera bitacoras.bloque_entrepiso) mandamos el resumen
    // de bloques distintos, o el campo suelto si aún no hay actividades con bloque.
    const bloquesDistintos = [
      ...new Set(input.actividades.map((a) => (a.bloque ?? '').trim()).filter(Boolean)),
    ];
    const bloqueEntrepiso = bloquesDistintos.length
      ? bloquesDistintos.join(', ')
      : input.bloqueEntrepiso;
    await this.sync.enqueue({
      id,
      tipo_op: 'bitacora',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        fecha: capturado_en.slice(0, 10),
        tipo: 'parte_diario',
        comentarios: input.comentarios,
        personal_carpinteria: input.personalCarpinteria,
        personal_acero: input.personalAcero,
        trabajadores_casa: input.trabajadoresCasa,
        otro_personal: input.otroPersonal,
        bloque_entrepiso: bloqueEntrepiso,
        ingeniero_responsable: input.ingenieroResponsable,
        hora_fin_trabajo: input.horaFinTrabajo,
        actividades: input.actividades.map((a) => ({
          estructura: a.estructura,
          actividad: a.actividad,
          cantidad: a.cantidad ?? null,
          unidad: a.unidad ?? null, // Q6 — unidad del trabajo realizado
          bloque: a.bloque?.trim() || null, // S4 — sujeto de esta actividad
        })),
        restricciones: input.restricciones.map((r) => ({
          tipo_restriccion: r.tipo_restriccion,
          descripcion_otro: r.descripcion_otro,
        })),
        llovio: input.llovio,
        lluvia_detalle: input.lluviaDetalle,
        hubo_migracion: input.huboMigracion,
        migracion_obreros: input.migracionObreros,
        // S7 — hay equipos si hay alguno en uso, para retirar o dañado.
        hubo_equipos: input.huboEquipos || input.equiposAlquilados.length > 0,
        equipos_alquilados: input.equiposAlquilados.map((e) => ({
          equipo: e.equipo,
          uso: e.uso,
          proveedor: e.proveedor,
          para_retirar: !!e.para_retirar, // S7
          danado: !!e.danado, // S7
          dano_detalle: e.dano_detalle ?? null, // S7
        })),
        capturado_en,
      },
      fotos: this.buildFotos(id, input.fotos),
      resumen: { tipo: 'parte_diario', proyecto_id: input.proyectoId, capturado_en },
    });
  }

  /** Q6 — unidades de medida (catálogo sgc.unidades), cacheadas offline como los
   *  demás catálogos, para el selector del trabajo realizado en el parte. */
  async getUnidades(): Promise<string[]> {
    const data = await this.catalog.refresh<string[]>('unidades', async () => {
      const { data, error } = await this.supabase.client
        .from('unidades')
        .select('nombre')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return ((data as { nombre: string }[]) ?? []).map((u) => u.nombre);
    });
    return data ?? [];
  }

  /** Planned line items for a project (R24), for the actividad quantity reference. */
  async getPartidas(proyectoId: string): Promise<ProyectoPartida[]> {
    const key = `partidas_${proyectoId}`;
    const data = await this.catalog.refresh<ProyectoPartida[]>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('proyecto_partidas')
        .select('id, nombre, unidad, cantidad_planeada, cantidad_ejecutada')
        .eq('proyecto_id', proyectoId)
        .eq('activa', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as ProyectoPartida[]) ?? [];
    });
    return data ?? [];
  }

  async enqueueIncidente(input: IncidenteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'bitacora',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        fecha: capturado_en.slice(0, 10),
        tipo: 'incidente',
        incidente_tipo: input.tipo,
        incidente_gravedad: input.gravedad,
        incidente_lesionados: input.lesionados,
        incidente_descripcion: input.descripcion,
        incidente_acciones: input.acciones,
        incidente_subcontratista: input.subcontratista,
        // S13 — suceso elegido + S12 — campos de equipo.
        incidente_suceso: input.suceso,
        incidente_equipo_nombre: input.equipoNombre,
        incidente_equipo_alquilado: input.equipoAlquilado,
        incidente_equipo_operativo: input.equipoOperativo,
        capturado_en,
      },
      fotos: [
        ...this.buildFotos(id, input.fotos),
        ...(input.voz
          ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `${id}/voz.webm`, slot: 'voz', blob: input.voz }]
          : []),
      ],
      resumen: { tipo: 'incidente', proyecto_id: input.proyectoId, capturado_en },
    });
  }

  /** My bitácoras (server, RLS-scoped to own), cached for offline viewing. */
  async misBitacoras(): Promise<BitacoraFull[]> {
    const data = await this.catalog.refresh<BitacoraFull[]>('mis_bitacoras', async () => {
      const { data, error } = await this.supabase.client
        .from('bitacoras')
        .select(
          'id, fecha, created_at, tipo, comentarios, bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo, personal_carpinteria, personal_acero, trabajadores_casa, otro_personal, incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados, incidente_descripcion, incidente_acciones, incidente_suceso, incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo, llovio, lluvia_detalle, hubo_migracion, migracion_obreros, hubo_equipos_alquilados, proyecto:proyectos(nombre), actividades:bitacora_actividades(estructura, actividad, cantidad, unidad, bloque), restricciones:bitacora_restricciones(tipo_restriccion, descripcion_otro), equipos:bitacora_equipos_alquilados(equipo, uso, proveedor, para_retirar, danado, dano_detalle), archivos:bitacora_archivos(nombre, url, tipo_mime)',
        )
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data as unknown as BitacoraFull[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * W2 — nombres de equipos alquilados usados recientemente, para el <datalist>
   * de sugerencias. Best-effort online; devuelve [] si falla o sin señal.
   */
  async getEquiposSugeridos(): Promise<string[]> {
    try {
      const { data, error } = await this.supabase.client
        .from('bitacora_equipos_alquilados')
        .select('equipo')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return [];
      const nombres = ((data as { equipo: string }[]) ?? [])
        .map((r) => (r.equipo ?? '').trim())
        .filter(Boolean);
      return [...new Set(nombres)].slice(0, 50);
    } catch {
      return [];
    }
  }

  /** Signed URL for a bitácora photo/audio (private sgc-bitacora bucket). */
  async getArchivoSignedUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  private buildFotos(id: string, blobs: Blob[]) {
    return blobs.map((blob, i) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `${id}/foto_${i}.jpg`,
      slot: `foto_${i}`,
      blob,
    }));
  }

  private registerHandler(): void {
    this.sync.register('bitacora', async (payload, photoPaths) => {
      const fotos = Object.keys(photoPaths).map((slot) => {
        const path = photoPaths[slot];
        const isAudio = path.endsWith('.webm');
        return {
          path,
          nombre: path.split('/').pop() ?? `${slot}.jpg`,
          tipo_mime: isAudio ? 'audio/webm' : 'image/jpeg',
        };
      });
      const { error } = await this.supabase.client.rpc('crear_bitacora_app', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_fecha: payload['fecha'],
        p_tipo: payload['tipo'],
        p_comentarios: payload['comentarios'] ?? null,
        p_personal_carpinteria: payload['personal_carpinteria'] ?? 0,
        p_personal_acero: payload['personal_acero'] ?? 0,
        p_trabajadores_casa: payload['trabajadores_casa'] ?? 0,
        p_otro_personal: payload['otro_personal'] ?? null,
        p_actividades: payload['actividades'] ?? [],
        p_restricciones: payload['restricciones'] ?? [],
        p_incidente_tipo: payload['incidente_tipo'] ?? null,
        p_incidente_gravedad: payload['incidente_gravedad'] ?? null,
        p_incidente_lesionados: payload['incidente_lesionados'] ?? 0,
        p_incidente_descripcion: payload['incidente_descripcion'] ?? null,
        p_incidente_acciones: payload['incidente_acciones'] ?? null,
        // S13/S12 — suceso + campos del incidente de equipo.
        p_incidente_suceso: payload['incidente_suceso'] ?? null,
        p_incidente_equipo_nombre: payload['incidente_equipo_nombre'] ?? null,
        p_incidente_equipo_alquilado: payload['incidente_equipo_alquilado'] ?? null,
        p_incidente_equipo_operativo: payload['incidente_equipo_operativo'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
        p_llovio: payload['llovio'] ?? null,
        p_lluvia_detalle: payload['lluvia_detalle'] ?? null,
        p_hubo_migracion: payload['hubo_migracion'] ?? null,
        p_migracion_obreros: payload['migracion_obreros'] ?? null,
        p_hubo_equipos: payload['hubo_equipos'] ?? null,
        p_equipos_alquilados: payload['equipos_alquilados'] ?? [],
        // W3 — paridad con la web
        p_bloque_entrepiso: payload['bloque_entrepiso'] ?? null,
        p_ingeniero_responsable: payload['ingeniero_responsable'] ?? null,
        p_hora_fin_trabajo: payload['hora_fin_trabajo'] ?? null,
        p_incidente_subcontratista: payload['incidente_subcontratista'] ?? null,
      });
      if (error) throwSyncError(error);

      // Alert management by email on incidents (fire-and-forget; the incident
      // is already in SGC + on the dashboard regardless).
      if (payload['tipo'] === 'incidente') {
        this.supabase.client.functions
          .invoke('notificar-incidente', { body: { bitacoraId: payload['id'] } })
          .catch(() => {});
      }
    });
  }
}
