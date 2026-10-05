import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { CatalogService } from '../sync/catalog.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';

/**
 * X6-app / AG9 — tipos de visita/mantenimiento, EXACTAMENTE los que acepta el
 * servidor (`crear_mantenimiento_app`). Cualquier otro valor el RPC lo coerce a
 * 'preventivo'. AG9 agregó 'otros' (tintado / servicios varios).
 */
export type MantenimientoTipo =
  | 'preventivo'
  | 'falla'
  | 'accidente_dano'
  | 'cambio_pieza'
  | 'engrase'
  | 'hidraulico'
  | 'reparacion'
  | 'tintado'
  | 'bombillo'
  | 'neumatico'
  | 'bateria'
  | 'lavado'
  | 'otros';

/** AG9/AL7 — etiqueta en español RD por tipo (para listar el historial en la app). */
export const MANTENIMIENTO_TIPO_LABEL: Record<MantenimientoTipo, string> = {
  preventivo: 'Mantenimiento de rutina',
  falla: 'Falla / avería',
  accidente_dano: 'Daño por accidente',
  cambio_pieza: 'Cambio de pieza',
  engrase: 'Engrase',
  hidraulico: 'Hidráulico',
  reparacion: 'Reparación',
  tintado: 'Tintado de cristales',
  bombillo: 'Cambio de bombillo',
  neumatico: 'Neumáticos / gomas',
  bateria: 'Batería',
  lavado: 'Lavado',
  otros: 'Otros servicios',
};

/** CG13 — tipo de documento de un adjunto de mantenimiento (coincide con el servidor). */
export type AdjuntoTipoDocumento = 'factura' | 'informe' | 'cotizacion' | 'garantia' | 'foto' | 'otro';

/** CG13 — etiqueta en español RD por tipo de documento del adjunto. */
export const ADJUNTO_TIPO_LABEL: Record<AdjuntoTipoDocumento, string> = {
  factura: 'Factura',
  informe: 'Informe del taller',
  cotizacion: 'Cotización',
  garantia: 'Garantía',
  foto: 'Foto',
  otro: 'Otro',
};

/** CG13 — un adjunto (imagen o PDF del taller) de un mantenimiento (tabla mantenimiento_adjuntos). */
export interface MantenimientoAdjunto {
  id: string;
  path: string;
  nombre: string | null;
  mime: string | null;
  tipo_documento: string;
}

/** CG13 — ¿el adjunto es un PDF? (para pintar el chip 📄 y abrir el visor de PDF). */
export function adjuntoEsPdf(a: MantenimientoAdjunto): boolean {
  return (a.mime ?? '').includes('pdf') || /\.pdf$/i.test(a.nombre ?? '') || /\.pdf$/i.test(a.path);
}

/** AG9 — una fila del historial de mantenimientos de un vehículo (mantenimientos_por_vehiculo). */
export interface MantenimientoItem {
  id: string;
  tipo: MantenimientoTipo;
  descripcion: string | null;
  fecha: string;
  estado: 'pendiente' | 'en_proceso' | 'completado';
  costo: number | null;
  proveedor: string | null;
  kilometraje: number | null;
  notas: string | null;
  fotos: string[] | null;
  incluye_preventivo: boolean;
  created_at: string;
  /** AL7 — quién registró el mantenimiento (chofer o flota). */
  creado_por?: string | null;
  registrado_por?: string | null;
  /** CG13 — adjuntos (imágenes + PDF del taller) con tipo de documento. */
  adjuntos?: MantenimientoAdjunto[];
  /** CG13 — placa/marca/modelo del vehículo (lista general; el RPC los anida en `vehiculo`). */
  vehiculo_id?: string | null;
  placa?: string | null;
  marca?: string | null;
  modelo?: string | null;
}

/** AG9 — input del cierre de mantenimiento (costo + evidencia) desde la app. */
export interface MantenimientoCierre {
  id: string; // id del mantenimiento a cerrar
  km: number | null;
  costo: number | null;
  proveedor: string | null;
  notas: string | null;
  fotos: Blob[];
  placa: string;
  vehiculoId: string;
}

/** Input the maintenance wizard hands to enqueueMantenimiento(). */
export interface MantenimientoCaptura {
  vehiculoId: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string; // YYYY-MM-DD
  km: number | null;
  /** X6-app — en visitas NO preventivas, si de paso se hizo preventivo. */
  incluyePreventivo: boolean;
  /** AL7 — costo opcional del trabajo. */
  costo?: number | null;
  /** AL7 — taller/proveedor donde se hizo. */
  proveedor?: string | null;
  /** AL7 — notas del trabajo (aparte de la descripción). */
  notas?: string | null;
  /** Up to 3 optional evidence photos, in capture order. */
  fotos: Blob[];
  /** CG13 — documentos del taller (PDF o imagen) con tipo, encolados como adjuntos. */
  adjuntos?: Array<{ blob: Blob; nombre: string; mime: string; tipoDocumento: string }>;
  /** Z23 — notas de voz múltiples (opcional). */
  voces?: Blob[];
  placa: string;
  /** AG15 — si nace de una tarea vinculada, su id (se enlaza al crear). */
  tareaVinculada?: string | null;
}

/**
 * Vehicle maintenance report write path. Mirrors VehiculosService: the capture
 * is enqueued in the offline outbox and committed by the registered handler
 * (crear_mantenimiento_app) when there's connectivity.
 */
@Injectable({ providedIn: 'root' })
export class MantenimientosService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);
  private catalog = inject(CatalogService);
  private audioNotas = inject(AudioNotasService);

  constructor() {
    this.registerHandler();
    this.registerCierreHandler();
    this.registerAdjuntoHandler(); // CG13
  }

  /**
   * AG9/CD4 — historial de mantenimientos de un vehículo (próximos/en curso/historial se
   * derivan en la UI de estado+fecha). Cacheado (read-through) para verse offline.
   *
   * CD4 (nota #95): la lectura pasa al RPC definir `listar_mantenimientos` (predicado
   * único `puede_ver_vehiculo` + índices + paginado servidor) en vez de `mantenimientos_
   * por_vehiculo` — arregla el `statement timeout` que sufría el chofer al leer bajo RLS.
   * Nada de lecturas directas a la tabla. Pedimos la primera página (200, el tope del
   * servidor) porque el historial de UN vehículo es pequeño; si un vehículo superara ese
   * tope, `listarMantenimientosPagina()` continúa por cursor (fecha,id).
   */
  async mantenimientosPorVehiculo(vehiculoId: string): Promise<MantenimientoItem[]> {
    const key = `mant_veh:${vehiculoId}`;
    const data = await this.catalog.refresh<MantenimientoItem[]>(key, async () => {
      const filas = await this.listarMantenimientosPagina(vehiculoId, 200, null, null);
      return filas;
    });
    return data ?? [];
  }

  /**
   * CD4 — una página del historial vía `listar_mantenimientos(p_vehiculo, p_limite,
   * p_cursor_fecha, p_cursor_id)`. Devuelve `setof jsonb`; aquí se normaliza al
   * `MantenimientoItem` de la app (el servidor usa `kilometraje_al_mantenimiento`).
   * Sin caché propia (la envuelve `mantenimientosPorVehiculo`); expuesto para poder
   * paginar por cursor si algún vehículo supera las 200 filas.
   */
  async listarMantenimientosPagina(
    vehiculoId: string | null,
    limite = 50,
    cursorFecha: string | null = null,
    cursorId: string | null = null,
  ): Promise<MantenimientoItem[]> {
    const { data, error } = await this.supabase.client.rpc('listar_mantenimientos', {
      p_vehiculo: vehiculoId,
      p_limite: limite,
      p_cursor_fecha: cursorFecha,
      p_cursor_id: cursorId,
    });
    if (error) throw error;
    const filas = (data as Record<string, unknown>[]) ?? [];
    return filas.map((m) => this.mapMantenimiento(m));
  }

  /** CD4 — normaliza una fila jsonb de `listar_mantenimientos` al modelo de la app. */
  private mapMantenimiento(m: Record<string, unknown>): MantenimientoItem {
    const km = m['kilometraje_al_mantenimiento'] ?? m['kilometraje'];
    // AL7 — el nombre de quien registró: el RPC nuevo lo anida en creado_por_usuario.nombre
    // (el viejo lo traía plano en registrado_por). `registrado_por` en el modelo = NOMBRE
    // (lo pinta la ficha: 🧑 {{ m.registrado_por }}); `creado_por` = uuid.
    const usuario = m['creado_por_usuario'] as { nombre?: string } | null;
    const nombre = usuario?.nombre ?? (m['registrado_por'] as string | null) ?? null;
    const veh = m['vehiculo'] as { placa?: string; marca?: string; modelo?: string } | null; // CG13
    return {
      id: String(m['id']),
      tipo: (m['tipo'] as MantenimientoTipo) ?? 'preventivo',
      descripcion: (m['descripcion'] as string | null) ?? null,
      fecha: String(m['fecha']),
      estado: (m['estado'] as MantenimientoItem['estado']) ?? 'pendiente',
      costo: (m['costo'] as number | null) ?? null,
      proveedor: (m['proveedor'] as string | null) ?? null,
      kilometraje: km == null ? null : Number(km),
      notas: (m['notas'] as string | null) ?? null,
      fotos: (m['fotos'] as string[] | null) ?? null,
      incluye_preventivo: !!m['incluye_preventivo'],
      created_at: String(m['created_at'] ?? ''),
      creado_por: (m['creado_por'] as string | null) ?? null,
      registrado_por: nombre,
      adjuntos: (m['adjuntos'] as MantenimientoAdjunto[] | null) ?? [], // CG13
      vehiculo_id: (m['vehiculo_id'] as string | null) ?? null,
      placa: veh?.placa ?? null,
      marca: veh?.marca ?? null,
      modelo: veh?.modelo ?? null,
    };
  }

  /**
   * CG13 — lista GENERAL de mantenimientos (todos los vehículos que el usuario
   * puede ver; el servidor filtra por `puede_ver_vehiculo`/submódulo flota). Una
   * sola página (200, el tope del servidor) + filtros en cliente: para la flota de
   * CSD cabe de sobra. Cacheada (read-through) para verse offline.
   */
  async listarMantenimientosGeneral(): Promise<MantenimientoItem[]> {
    const data = await this.catalog.refresh<MantenimientoItem[]>('mant_general', async () => {
      return this.listarMantenimientosPagina(null, 200, null, null);
    });
    return data ?? [];
  }

  /** CG13 — URL firmada (1 h) de un adjunto en el bucket `vehiculos` (privado). */
  async signedUrlAdjunto(path: string): Promise<string | null> {
    const { data } = await this.supabase.client.storage.from('vehiculos').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  /**
   * CG13 — encola un ADJUNTO (imagen o PDF del taller) de un mantenimiento. Funciona
   * offline: el archivo sube al bucket `vehiculos` y el handler inserta la fila en
   * `mantenimiento_adjuntos`. Idempotente por `adjunto_id`. El mantenimiento debe
   * existir (FK): como el outbox es FIFO, si se encola DESPUÉS del alta (misma sesión
   * offline), el alta corre primero.
   */
  async enqueueAdjunto(input: {
    mantenimientoId: string;
    vehiculoId: string;
    blob: Blob;
    nombre: string;
    mime: string;
    tipoDocumento: string;
  }): Promise<void> {
    const adjId = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const ext = input.mime.includes('pdf')
      ? 'pdf'
      : (input.nombre.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `mantenimiento/${input.mantenimientoId}/adjuntos/${adjId}.${ext}`;
    await this.sync.enqueue({
      id: `mant_adj_${adjId}`,
      tipo_op: 'mantenimiento_adjunto',
      capturado_en,
      payload: {
        adjunto_id: adjId,
        mantenimiento_id: input.mantenimientoId,
        vehiculo_id: input.vehiculoId,
        nombre: input.nombre,
        mime: input.mime,
        tipo_documento: input.tipoDocumento,
      },
      fotos: [{ id: adjId, bucket: 'vehiculos', path, slot: 'archivo', blob: input.blob }],
      resumen: { nombre: input.nombre, capturado_en },
    });
  }

  /** AG9 — encola el CIERRE de un mantenimiento (costo/proveedor/notas + evidencia). */
  async enqueueCierre(input: MantenimientoCierre): Promise<void> {
    const capturado_en = new Date().toISOString();
    const fotos = input.fotos.map((blob, idx) => ({
      id: crypto.randomUUID(),
      bucket: 'vehiculos',
      path: `mantenimiento/${input.id}/cierre_${idx}.jpg`,
      slot: `cierre_${idx}`,
      blob,
    }));
    await this.sync.enqueue({
      id: `cierre_${input.id}`, // idempotencia: un cierre por mantenimiento
      tipo_op: 'mantenimiento_cierre',
      capturado_en,
      payload: {
        id: input.id,
        vehiculo_id: input.vehiculoId,
        km: input.km,
        costo: input.costo,
        proveedor: input.proveedor,
        notas: input.notas,
      },
      fotos,
      resumen: { placa: input.placa, capturado_en },
    });
  }

  /** Queue a maintenance report. Works fully offline; syncs when there's signal. */
  async enqueueMantenimiento(input: MantenimientoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = input.fotos.map((blob, idx) => ({
      id: crypto.randomUUID(),
      bucket: 'vehiculos',
      path: `mantenimiento/${id}/foto_${idx}.jpg`,
      slot: `foto_${idx}`,
      blob,
    }));
    // Z23 — notas de voz (audio_notas, bucket flota-documentos).
    const audio = this.audioNotas.buildAttachments('mantenimiento', id, AUDIO_BUCKET_FLOTA, input.voces ?? []);
    fotos.push(...audio.fotos);

    await this.sync.enqueue({
      id,
      tipo_op: 'mantenimiento',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        tipo: input.tipo,
        descripcion: input.descripcion,
        fecha: input.fecha,
        km: input.km,
        incluye_preventivo: input.incluyePreventivo,
        costo: input.costo ?? null, // AL7
        proveedor: input.proveedor ?? null, // AL7 (taller)
        notas: input.notas ?? null, // AL7
        audios: audio.audios, // Z23
        tarea_vinculada: input.tareaVinculada ?? null, // AG15
      },
      fotos,
      resumen: { placa: input.placa, tipo: input.tipo, capturado_en },
    });

    // CG13 — documentos del taller (PDF/imagen) → adjuntos (tras el alta; FIFO).
    for (const a of input.adjuntos ?? []) {
      await this.enqueueAdjunto({
        mantenimientoId: id,
        vehiculoId: input.vehiculoId,
        blob: a.blob,
        nombre: a.nombre,
        mime: a.mime,
        tipoDocumento: a.tipoDocumento,
      });
    }
  }

  private registerHandler(): void {
    this.sync.register('mantenimiento', async (payload, photoPaths) => {
      const fotos = Object.entries(photoPaths)
        .filter(([slot]) => !slot.startsWith('audio_'))
        .map(([slot, path]) => ({ storage_path: path, slot }));

      const { error } = await this.supabase.client.rpc('crear_mantenimiento_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_tipo: payload['tipo'],
        p_descripcion: payload['descripcion'],
        p_fecha: payload['fecha'],
        p_km: payload['km'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
        p_incluye_preventivo: payload['incluye_preventivo'] ?? false,
        p_costo: payload['costo'] ?? null, // AL7
        p_proveedor: payload['proveedor'] ?? null, // AL7
        p_notas: payload['notas'] ?? null, // AL7
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);

      // Z23 — registrar las notas de voz (idempotente por path).
      await this.audioNotas.commit('mantenimiento', payload['id'] as string, payload['audios'] as AudioNotaMeta[] | undefined, photoPaths);

      // AG15 — si el mantenimiento nace de una tarea vinculada, enlázala (la tarea
      // se completa sola al cerrarse el mantenimiento). Idempotente.
      const tareaVinc = payload['tarea_vinculada'] as string | null;
      if (tareaVinc) {
        const { error: eV } = await this.supabase.client.rpc('vincular_tarea_entidad', {
          p_tarea_id: tareaVinc,
          p_tipo: 'mantenimiento',
          p_entity_id: payload['id'],
        });
        if (eV) throwSyncError(eV);
      }

      // P7 — el RPC avanza vehiculos.kilometraje; invalidar caches con km.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate(`mant_veh:${vehId}`); // AG9 — refrescar el historial
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones'); // AF21
    });
  }

  /** AG9 — handler del cierre: completar_mantenimiento_app (costo + evidencia). */
  private registerCierreHandler(): void {
    this.sync.register('mantenimiento_cierre', async (payload, photoPaths) => {
      const fotos = Object.entries(photoPaths).map(([slot, path]) => ({ storage_path: path, slot }));
      const { error } = await this.supabase.client.rpc('completar_mantenimiento_app', {
        p_id: payload['id'],
        p_km: payload['km'] ?? null,
        p_costo: payload['costo'] ?? null,
        p_proveedor: payload['proveedor'] ?? null,
        p_notas: payload['notas'] ?? null,
        p_fotos: fotos,
      });
      if (error) throwSyncError(error);

      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate(`mant_veh:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones');
    });
  }

  /**
   * CG13 — handler del adjunto: inserta la fila en `mantenimiento_adjuntos` con el
   * path ya subido por el motor del outbox. Idempotente (upsert por id → si el envío
   * se reintenta tras subir el archivo, no duplica). La RLS deja escribir a flota /
   * a quien puede ver el vehículo del mantenimiento.
   */
  private registerAdjuntoHandler(): void {
    this.sync.register('mantenimiento_adjunto', async (payload, photoPaths) => {
      const path = photoPaths['archivo'];
      if (!path) throw new Error('Falta el archivo del adjunto.');
      const { error } = await this.supabase.client.from('mantenimiento_adjuntos').upsert(
        {
          id: payload['adjunto_id'],
          mantenimiento_id: payload['mantenimiento_id'],
          path,
          nombre: payload['nombre'] ?? null,
          mime: payload['mime'] ?? null,
          tipo_documento: payload['tipo_documento'] ?? 'otro',
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (error) throwSyncError(error);

      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`mant_veh:${vehId}`);
      await this.catalog.invalidate('mant_general');
    });
  }
}
