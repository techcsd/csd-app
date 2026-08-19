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
  // Z21 — foto opcional por restricción (→ bitacora_restricciones.foto_path).
  // AA9 — nota de voz opcional por restricción (→ bitacora_restricciones.audio_path).
  restricciones: {
    tipo_restriccion: string;
    descripcion_otro: string | null;
    foto?: Blob | null;
    voz?: Blob | null;
  }[];
  comentarios: string | null;
  fotos: Blob[];
  // Z23 — notas de voz múltiples (bitacora_archivos).
  voces: Blob[];
  // R21/R22 — clima y migración (el clima NO es incidente).
  llovio: boolean | null;
  lluviaDetalle: string | null;
  // Z5 — horas que la lluvia afectó (0..24), solo si llovió.
  horasLluvia: number | null;
  huboMigracion: boolean | null;
  migracionObreros: string[] | null;
  // W2 — equipos alquilados en uso hoy.
  huboEquipos: boolean | null;
  // Z22/AA10 — cada equipo dañado puede llevar VARIAS fotos, que van a
  // bitacora_equipos_alquilados.fotos_paths[] (+ foto_path = la primera).
  equiposAlquilados: (EquipoAlquilado & { fotos?: Blob[] })[];
  // Z4 — "No se trabajó en obra": vuela el resto del parte, solo pide el motivo.
  sinActividad: boolean;
  motivoSinActividad: string | null;
  motivoSinActividadDetalle: string | null;
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
  // T19 — comentario de operatividad (obligatorio si quedó fuera de servicio).
  equipoOperativoComentario: string | null;
  fotos: Blob[];
  // Z23 — notas de voz múltiples (antes una sola). Van a bitacora_archivos.
  voces: Blob[];
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
    const rows = await this.catalog.refresh<
      { tipo: string; valor: string; destacado: boolean; permite_sin_cantidad: boolean }[]
    >(key, async () => {
      const { data, error } = await this.supabase.client.rpc('catalogo_ordenado', {
        p_proyecto_id: proyectoId,
      });
      if (error) throw new Error(error.message);
      // El RPC ya devuelve las filas ordenadas (destacadas primero, luego orden).
      return (
        (data as {
          tipo: string;
          valor: string;
          activo: boolean;
          destacado: boolean;
          permite_sin_cantidad?: boolean;
        }[]) ?? []
      )
        .filter((r) => r.activo !== false)
        .map((r) => ({
          tipo: r.tipo,
          valor: r.valor,
          destacado: !!r.destacado,
          permite_sin_cantidad: !!r.permite_sin_cantidad, // AW1
        }));
    });
    const list = rows ?? [];
    if (list.length) {
      const by = (t: string): CatOrdenado[] =>
        list
          .filter((r) => r.tipo === t)
          .map((r) => ({ valor: r.valor, destacado: r.destacado, permite_sin_cantidad: r.permite_sin_cantidad }));
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
      // QA-17: el SELECT directo sobre `proyectos` devolvía [] a usuarios de bitácora
      // sin vínculo de empleado (la RLS no admite ese módulo). Vía RPC security-definer
      // que devuelve id/nombre/responsable_nombre para los roles que arman partes.
      const { data, error } = await this.supabase.client.rpc('proyectos_pickables');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** Encola el parte y devuelve su id (client-UUID = id de la bitácora), para que
   *  el llamador pueda enlazar una tarea del cronograma en la misma sesión (Y15.8). */
  async enqueueParteDiario(input: ParteDiarioCaptura): Promise<string> {
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
          es_aproximada: a.es_aproximada ?? false, // AW1 — cantidad aproximada
        })),
        restricciones: input.restricciones.map((r, i) => ({
          tipo_restriccion: r.tipo_restriccion,
          descripcion_otro: r.descripcion_otro,
          // Z21 — slot de la foto opcional; el handler lo resuelve a foto_path.
          foto_slot: r.foto instanceof Blob ? `restr_${i}` : null,
          // AA9 — slot de la nota de voz opcional; el handler → audio_path.
          audio_slot: r.voz instanceof Blob ? `restraudio_${i}` : null,
        })),
        llovio: input.llovio,
        lluvia_detalle: input.lluviaDetalle,
        horas_lluvia: input.horasLluvia, // Z5
        hubo_migracion: input.huboMigracion,
        migracion_obreros: input.migracionObreros,
        // Z4 — "no se trabajó en obra"
        sin_actividad: input.sinActividad,
        motivo_sin_actividad: input.motivoSinActividad,
        motivo_sin_actividad_detalle: input.motivoSinActividadDetalle,
        // S7 — hay equipos si hay alguno en uso, para retirar o dañado.
        hubo_equipos: input.huboEquipos || input.equiposAlquilados.length > 0,
        equipos_alquilados: input.equiposAlquilados.map((e, i) => ({
          equipo: e.equipo,
          uso: e.uso,
          proveedor: e.proveedor,
          para_retirar: !!e.para_retirar, // S7
          danado: !!e.danado, // S7
          dano_detalle: e.dano_detalle ?? null, // S7
          // Z22/AA10 — slots de las fotos del equipo dañado (varias); el handler
          // las resuelve a fotos_paths[] (mismos índices que buildEquipoDanoFotos).
          fotos_slots: (e.fotos ?? [])
            .map((f, j) => (f instanceof Blob ? `dano_${i}_${j}` : null))
            .filter((s): s is string => !!s),
        })),
        capturado_en,
      },
      fotos: [
        ...this.buildFotos(id, input.fotos),
        ...this.buildRestriccionFotos(id, input.restricciones),
        ...this.buildRestriccionVoces(id, input.restricciones), // AA9
        ...this.buildEquipoDanoFotos(id, input.equiposAlquilados),
        ...this.buildVoces(id, input.voces),
      ],
      resumen: { tipo: 'parte_diario', proyecto_id: input.proyectoId, capturado_en },
    });
    return id;
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
        incidente_equipo_operativo_comentario: input.equipoOperativoComentario,
        capturado_en,
      },
      fotos: [
        ...this.buildFotos(id, input.fotos),
        ...this.buildVoces(id, input.voces),
      ],
      resumen: { tipo: 'incidente', proyecto_id: input.proyectoId, capturado_en },
    });
  }

  /** AW2/AW5 — select común (incluye usuario_id para el autor + es_aproximada AW1). */
  private readonly BITA_SELECT =
    'id, fecha, created_at, tipo, usuario_id, comentarios, bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo, personal_carpinteria, personal_acero, trabajadores_casa, otro_personal, incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados, incidente_descripcion, incidente_acciones, incidente_suceso, incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo, incidente_equipo_operativo_comentario, llovio, lluvia_detalle, horas_lluvia, hubo_migracion, migracion_obreros, hubo_equipos_alquilados, sin_actividad, motivo_sin_actividad, motivo_sin_actividad_detalle, proyecto:proyectos(nombre), actividades:bitacora_actividades(estructura, actividad, cantidad, unidad, bloque, es_aproximada), restricciones:bitacora_restricciones(tipo_restriccion, descripcion_otro), equipos:bitacora_equipos_alquilados(equipo, uso, proveedor, para_retirar, danado, dano_detalle, foto_path), archivos:bitacora_archivos(nombre, url, tipo_mime, transcripcion, transcripcion_estado)';

  /** AW2 — resuelve el nombre del autor (usuario_id) vía usuarios_por_ids (RLS-safe;
   *  `usuarios` es admin-only). Best-effort: sin red, quedan sin nombre. */
  private async resolverAutores(rows: BitacoraFull[]): Promise<BitacoraFull[]> {
    const ids = [...new Set(rows.map((r) => r.usuario_id).filter(Boolean))] as string[];
    if (!ids.length) return rows;
    try {
      const { data } = await this.supabase.client.rpc('usuarios_por_ids', { p_ids: ids });
      const nameById = new Map(((data as { id: string; nombre: string }[]) ?? []).map((u) => [u.id, u.nombre]));
      for (const r of rows) if (r.usuario_id) r.autor_nombre = nameById.get(r.usuario_id) ?? null;
    } catch {
      /* offline / sin permiso: best-effort */
    }
    return rows;
  }

  /** Mis bitácoras (solo las propias), cacheadas para ver offline. AW5 — se filtra
   *  por usuario_id explícito porque para roles elevados la RLS ya abre las ajenas. */
  async misBitacoras(): Promise<BitacoraFull[]> {
    const data = await this.catalog.refresh<BitacoraFull[]>('mis_bitacoras', async () => {
      const uid = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
      let query = this.supabase.client
        .from('bitacoras')
        .select(this.BITA_SELECT)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (uid) query = query.eq('usuario_id', uid);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return this.resolverAutores((data as unknown as BitacoraFull[]) ?? []);
    });
    return data ?? [];
  }

  /** AW5 — TODAS las bitácoras (de todos los ingenieros). Solo para roles con
   *  permiso (la RLS abre las filas server-side); online. */
  async todasBitacoras(): Promise<BitacoraFull[]> {
    const { data, error } = await this.supabase.client
      .from('bitacoras')
      .select(this.BITA_SELECT)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return this.resolverAutores((data as unknown as BitacoraFull[]) ?? []);
  }

  /** AW5 — ¿puedo ver bitácoras de otros? (gate server-side; conmuta el tab "Todas"). */
  async puedeVerOtrasBitacoras(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('puede_ver_otras_bitacoras');
    if (error) return false;
    return (data as boolean) ?? false;
  }

  /**
   * T19 — equipos ya vistos en ESTA obra (equipos alquilados + incidentes de
   * equipo + valores "Otro"), vía RPC security-definer, cacheado offline por
   * obra. Alimenta el selector del incidente de equipo y el paso 8 del parte
   * para evitar nombres inconsistentes (camión/patana/guagua…).
   */
  async getEquiposDeObra(proyectoId: string): Promise<string[]> {
    if (!proyectoId) return [];
    const data = await this.catalog.refresh<string[]>(`equipos_obra_${proyectoId}`, async () => {
      const { data, error } = await this.supabase.client.rpc('equipos_de_obra', {
        p_proyecto_id: proyectoId,
      });
      if (error) throw new Error(error.message);
      return ((data as { nombre: string }[]) ?? [])
        .map((r) => (r.nombre ?? '').trim())
        .filter(Boolean);
    });
    return data ?? [];
  }

  /**
   * Z14/Z20 — estructuras definidas por la obra (bloques/pisos/edificios), del
   * catálogo `proyecto_estructuras`. Alimenta el selector del paso 5 del parte
   * (+ "Otro" texto libre). Cacheado offline por obra; si la obra no tiene
   * estructuras definidas, devuelve [] y el paso 5 cae a texto libre (sin fricción).
   */
  async getEstructurasObra(proyectoId: string): Promise<string[]> {
    if (!proyectoId) return [];
    const data = await this.catalog.refresh<string[]>(`proyecto_estructuras_${proyectoId}`, async () => {
      const { data, error } = await this.supabase.client
        .from('proyecto_estructuras')
        .select('nombre, orden')
        .eq('proyecto_id', proyectoId)
        .eq('activa', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as { nombre: string }[]) ?? [])
        .map((r) => (r.nombre ?? '').trim())
        .filter(Boolean);
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

  /** Z21 — foto opcional por restricción (slot restr_<i>). El handler la enruta a
   *  bitacora_restricciones.foto_path (NO al montón general de fotos). */
  private buildRestriccionFotos(
    id: string,
    restricciones: { foto?: Blob | null }[],
  ) {
    return restricciones
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.foto instanceof Blob)
      .map((x) => ({
        id: crypto.randomUUID(),
        bucket: BUCKET,
        path: `${id}/restr_${x.i}.jpg`,
        slot: `restr_${x.i}`,
        blob: x.r.foto as Blob,
      }));
  }

  /** AA9 — nota de voz opcional por restricción (slot restraudio_<i>). El handler
   *  la enruta a bitacora_restricciones.audio_path (no al montón general). */
  private buildRestriccionVoces(id: string, restricciones: { voz?: Blob | null }[]) {
    return restricciones
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.voz instanceof Blob)
      .map((x) => ({
        id: crypto.randomUUID(),
        bucket: BUCKET,
        path: `${id}/restraudio_${x.i}.webm`,
        slot: `restraudio_${x.i}`,
        blob: x.r.voz as Blob,
      }));
  }

  /** Z22/AA10 — fotos del equipo dañado (VARIAS, slots dano_<i>_<j>). El handler
   *  las enruta a bitacora_equipos_alquilados.fotos_paths[] (no al montón general). */
  private buildEquipoDanoFotos(id: string, equipos: { fotos?: Blob[] }[]) {
    const out: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }> = [];
    equipos.forEach((e, i) => {
      (e.fotos ?? []).forEach((blob, j) => {
        if (!(blob instanceof Blob)) return;
        out.push({
          id: crypto.randomUUID(),
          bucket: BUCKET,
          path: `${id}/dano_${i}_${j}.jpg`,
          slot: `dano_${i}_${j}`,
          blob,
        });
      });
    });
    return out;
  }

  /** Z23 — N notas de voz como adjuntos de audio (bitacora_archivos). El handler
   *  las reconoce por la extensión .webm y las marca tipo_mime audio/webm. */
  private buildVoces(id: string, blobs: Blob[]) {
    return (blobs ?? []).map((blob, i) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `${id}/voz_${i}.webm`,
      slot: `voz_${i}`,
      blob,
    }));
  }

  private registerHandler(): void {
    this.sync.register('bitacora', async (payload, photoPaths) => {
      // Z21/Z22 — las fotos de restricción (restr_*) y de equipo dañado (dano_*)
      // NO van al montón general: se enrutan a su foto_path más abajo.
      const fotos = Object.keys(photoPaths)
        .filter(
          (slot) =>
            !slot.startsWith('restr_') && !slot.startsWith('dano_') && !slot.startsWith('restraudio_'),
        )
        .map((slot) => {
          const path = photoPaths[slot];
          const isAudio = path.endsWith('.webm');
          return {
            path,
            nombre: path.split('/').pop() ?? `${slot}.jpg`,
            tipo_mime: isAudio ? 'audio/webm' : 'image/jpeg',
          };
        });
      // Z21 — resolver el slot de cada restricción a su foto_path subido.
      const restricciones = ((payload['restricciones'] as
        | { tipo_restriccion: string; descripcion_otro: string | null; foto_slot?: string | null; audio_slot?: string | null }[]
        | undefined) ?? []).map((r) => ({
        tipo_restriccion: r.tipo_restriccion,
        descripcion_otro: r.descripcion_otro,
        foto_path: r.foto_slot ? (photoPaths[r.foto_slot] ?? null) : null,
        audio_path: r.audio_slot ? (photoPaths[r.audio_slot] ?? null) : null, // AA9
      }));
      // Z22 — resolver el slot de la foto de cada equipo dañado a su foto_path.
      const equipos = ((payload['equipos_alquilados'] as
        | {
            equipo: string;
            uso: string | null;
            proveedor: string | null;
            para_retirar: boolean;
            danado: boolean;
            dano_detalle: string | null;
            fotos_slots?: string[] | null;
          }[]
        | undefined) ?? []).map((e) => {
        const fotos_paths = (e.fotos_slots ?? [])
          .map((s) => photoPaths[s])
          .filter((p): p is string => !!p);
        return {
          equipo: e.equipo,
          uso: e.uso,
          proveedor: e.proveedor,
          para_retirar: e.para_retirar,
          danado: e.danado,
          dano_detalle: e.dano_detalle,
          // AA10 — todas las fotos; foto_path = la primera (retrocompat web).
          fotos_paths,
          foto_path: fotos_paths[0] ?? null,
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
        p_restricciones: restricciones, // Z21 — con foto_path resuelto
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
        p_incidente_equipo_operativo_comentario: payload['incidente_equipo_operativo_comentario'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
        p_llovio: payload['llovio'] ?? null,
        p_lluvia_detalle: payload['lluvia_detalle'] ?? null,
        p_horas_lluvia: payload['horas_lluvia'] ?? null, // Z5
        p_hubo_migracion: payload['hubo_migracion'] ?? null,
        p_migracion_obreros: payload['migracion_obreros'] ?? null,
        // Z4 — "no se trabajó en obra"
        p_sin_actividad: payload['sin_actividad'] ?? false,
        p_motivo_sin_actividad: payload['motivo_sin_actividad'] ?? null,
        p_motivo_sin_actividad_detalle: payload['motivo_sin_actividad_detalle'] ?? null,
        p_hubo_equipos: payload['hubo_equipos'] ?? null,
        p_equipos_alquilados: equipos, // Z22 — con foto_path resuelto
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
