import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { BorradorService } from './borrador.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { db } from '../db/app-db';

/** CK12 — tipo de apoyo de transporte (3 botones del formulario). */
export type TipoApoyo = 'movimiento_interno' | 'retiro_material' | 'bote';

/** CK12/CK13 — ciclo de estados (ampliado). pendiente(sin asignar) → asignada
 *  (Misael la dio a un chofer) → en_proceso → por_confirmar (el chofer terminó)
 *  → completada / cancelada. */
export type EstadoApoyo =
  | 'pendiente'
  | 'asignada'
  | 'en_proceso'
  | 'por_confirmar'
  | 'completada'
  | 'cancelada';

/** CK12 — destino (solo para movimiento interno; bote/retiro lo fijan server-side). */
export type DestinoApoyoTipo = 'obra' | 'almacen' | 'otro';

/** CK12 — una fila de apoyo_transporte_listado (aplanada para la UI). */
export interface ApoyoListadoRow {
  id: string;
  tipo_apoyo: TipoApoyo;
  proyecto_id: string | null;
  proyecto: string | null;
  dia: string | null;
  descripcion: string;
  estado: EstadoApoyo;
  solicitante: string | null;
  conductor_id: string | null;
  ruta_id: string | null;
  foto_path: string | null;
  created_at: string;
  /** URL firmada de la primera foto (best-effort; null offline o sin foto). */
  foto_url?: string | null;
  /** CK12 — true cuando la fila vive aún en el outbox (sin enviar). */
  pendiente?: boolean;
}

/** CK12/CK13 — una foto del apoyo (ficha). */
export interface ApoyoFoto {
  id: string;
  path: string;
  url?: string | null;
}

/** CK13 — un evento de la línea de tiempo de estados. */
export interface ApoyoEvento {
  de: string | null;
  a: string | null;
  nota: string | null;
  por: string | null;
  created_at: string;
}

/** CK12/CK13 — ficha completa de un apoyo (apoyo_transporte_detalle → jsonb). */
export interface ApoyoDetalle {
  id: string;
  tipo_apoyo: TipoApoyo;
  proyecto_id: string | null;
  proyecto: string | null;
  solicitante: string | null;
  solicitante_id: string | null;
  created_by: string | null;
  conductor: string | null;
  conductor_id: string | null;
  ruta_id: string | null;
  dia: string | null;
  descripcion: string;
  estado: EstadoApoyo;
  destino_tipo: DestinoApoyoTipo | null;
  destino_texto: string | null;
  destino_bodega_id: string | null;
  destino_proyecto_id: string | null;
  es_danado: boolean;
  retiro_material_id: string | null;
  motivo_cancelacion: string | null;
  created_at: string;
  fotos: ApoyoFoto[];
  eventos: ApoyoEvento[];
}

/** CK12 — input del formulario de creación (ingeniero). */
export interface CrearApoyoInput {
  tipoApoyo: TipoApoyo;
  proyectoId: string;
  proyectoNombre?: string | null;
  dia: string; // YYYY-MM-DD
  descripcion: string;
  destinoTipo?: DestinoApoyoTipo | null;
  destinoTexto?: string | null;
  destinoBodegaId?: string | null;
  destinoProyectoId?: string | null;
  esDanado?: boolean;
  fotos: Blob[];
}

/** CK12 — filtros del listado. */
export interface FiltrosApoyo {
  tipo?: TipoApoyo | null;
  estado?: EstadoApoyo | null;
  proyectoId?: string | null;
  dia?: string | null;
}

const BUCKET = 'apoyo-transporte';
const OP_CREAR = 'apoyo_crear';
const OP_ESTADO = 'apoyo_estado';
const CAT_LISTADO = 'apoyo_listado';

/**
 * CK11/CK12/CK13 — "Apoyo de transporte". Evoluciona solicitudes_movimiento (NO
 * tabla nueva): un ingeniero pide mover algo (movimiento interno / retiro / bote)
 * con una descripción libre + fotos; el referente de transporte (Misael) lo asigna
 * a un chofer; el ingeniero cierra el estado.
 *
 * Offline-first (ADR-002): crear y cambiar estado van por OUTBOX con UUID cliente.
 * Las fotos NO se pre-suben (el bucket exige folder=<solicitud_id> y la solicitud
 * nace server-side): el handler primero CREA la solicitud (devuelve el id), luego
 * sube cada foto a `apoyo-transporte/<id>/…` y la referencia con
 * apoyo_transporte_agregar_foto. Los blobs se persisten como borrador_fotos
 * (WebKit-safe, sobreviven un kill del SO) hasta que el envío cierra.
 */
@Injectable({ providedIn: 'root' })
export class ApoyoService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private borrador = inject(BorradorService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  /** Clave del borrador de fotos de un apoyo (por op/cliente id). */
  private claveFotos(opId: string): string {
    return `apoyo:${opId}`;
  }

  /**
   * CK12 — lista los apoyos visibles (RLS: solicitante, su obra, referente). Las
   * filas pendientes del outbox se anteponen como "Pendiente de enviar". Cacheado
   * read-through por combinación de filtros (offline-friendly).
   */
  async listar(f: FiltrosApoyo = {}): Promise<ApoyoListadoRow[]> {
    const key = `${CAT_LISTADO}:${f.tipo ?? ''}:${f.estado ?? ''}:${f.proyectoId ?? ''}:${f.dia ?? ''}`;
    const data = await this.catalog.refresh<ApoyoListadoRow[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('apoyo_transporte_listado', {
        p_tipo: f.tipo ?? null,
        p_estado: f.estado ?? null,
        p_proyecto_id: f.proyectoId ?? null,
        p_dia: f.dia ?? null,
      });
      if (error) throw new Error(error.message);
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: r['id'] as string,
        tipo_apoyo: (r['tipo_apoyo'] as TipoApoyo) ?? 'movimiento_interno',
        proyecto_id: (r['proyecto_id'] as string) ?? null,
        proyecto: (r['proyecto'] as string) ?? null,
        dia: (r['dia'] as string) ?? null,
        descripcion: (r['descripcion'] as string) ?? '',
        estado: (r['estado'] as EstadoApoyo) ?? 'pendiente',
        solicitante: (r['solicitante'] as string) ?? null,
        conductor_id: (r['conductor_id'] as string) ?? null,
        ruta_id: (r['ruta_id'] as string) ?? null,
        foto_path: (r['foto_path'] as string) ?? null,
        created_at: r['created_at'] as string,
      }));
    });
    const servidor = data ?? [];
    // Firma la primera foto de cada fila (best-effort; cae a null offline).
    await Promise.all(
      servidor.map(async (row) => {
        row.foto_url = row.foto_path ? await this.signFoto(row.foto_path) : null;
      }),
    );
    const pendientes = await this.pendientesLocales(f);
    return [...pendientes, ...servidor];
  }

  /** CK12 — apoyos aún en el outbox (sin enviar), mapeados a filas de listado. */
  private async pendientesLocales(f: FiltrosApoyo): Promise<ApoyoListadoRow[]> {
    try {
      // `tipo_op` no está indexado en Dexie → scan + filter (no .where()).
      const ops = (await db.outbox.toArray())
        .filter((o) => o.tipo_op === OP_CREAR)
        .sort((a, b) => b.created_local - a.created_local);
      return ops
        .map((op) => {
          const p = op.payload as Record<string, unknown>;
          return {
            id: op.id,
            tipo_apoyo: (p['tipo_apoyo'] as TipoApoyo) ?? 'movimiento_interno',
            proyecto_id: (p['proyecto_id'] as string) ?? null,
            proyecto: (p['proyecto_nombre'] as string) ?? null,
            dia: (p['dia'] as string) ?? null,
            descripcion: (p['descripcion'] as string) ?? '',
            estado: 'pendiente' as EstadoApoyo,
            solicitante: null,
            conductor_id: null,
            ruta_id: null,
            foto_path: null,
            created_at: op.capturado_en,
            foto_url: null,
            pendiente: true,
          } satisfies ApoyoListadoRow;
        })
        .filter((row) => {
          if (f.tipo && row.tipo_apoyo !== f.tipo) return false;
          if (f.proyectoId && row.proyecto_id !== f.proyectoId) return false;
          if (f.dia && row.dia !== f.dia) return false;
          // Un pendiente siempre está en estado 'pendiente'.
          if (f.estado && f.estado !== 'pendiente') return false;
          return true;
        });
    } catch {
      return [];
    }
  }

  /**
   * CK12/CK13 — ficha de un apoyo (fotos + línea de tiempo de estados). Cacheada
   * read-through (rutas de foto, no URLs firmadas que caducan). Null = no existe /
   * sin acceso / caché vacía offline.
   */
  async detalle(id: string): Promise<ApoyoDetalle | null> {
    const raw = await this.catalog.refresh<Record<string, unknown> | null>(
      `apoyo_detalle:${id}`,
      async () => {
        const { data, error } = await this.supabase.client.rpc('apoyo_transporte_detalle', { p_id: id });
        if (error) throw new Error(error.message);
        return (data as Record<string, unknown>) ?? null;
      },
    );
    if (!raw) return null;
    const fotos: ApoyoFoto[] = ((raw['fotos'] as Array<Record<string, unknown>>) ?? []).map((ff) => ({
      id: ff['id'] as string,
      path: ff['path'] as string,
    }));
    await Promise.all(fotos.map(async (ff) => (ff.url = await this.signFoto(ff.path))));
    return {
      id: raw['id'] as string,
      tipo_apoyo: (raw['tipo_apoyo'] as TipoApoyo) ?? 'movimiento_interno',
      proyecto_id: (raw['proyecto_id'] as string) ?? null,
      proyecto: (raw['proyecto'] as string) ?? null,
      solicitante: (raw['solicitante'] as string) ?? null,
      solicitante_id: (raw['solicitante_id'] as string) ?? null,
      created_by: (raw['created_by'] as string) ?? null,
      conductor: (raw['conductor'] as string) ?? null,
      conductor_id: (raw['conductor_id'] as string) ?? null,
      ruta_id: (raw['ruta_id'] as string) ?? null,
      dia: (raw['dia'] as string) ?? null,
      descripcion: (raw['descripcion'] as string) ?? (raw['que_se_mueve'] as string) ?? '',
      estado: (raw['estado'] as EstadoApoyo) ?? 'pendiente',
      destino_tipo: (raw['destino_tipo'] as DestinoApoyoTipo) ?? null,
      destino_texto: (raw['destino_texto'] as string) ?? null,
      destino_bodega_id: (raw['destino_bodega_id'] as string) ?? null,
      destino_proyecto_id: (raw['destino_proyecto_id'] as string) ?? null,
      es_danado: (raw['es_danado'] as boolean) ?? false,
      retiro_material_id: (raw['retiro_material_id'] as string) ?? null,
      motivo_cancelacion: (raw['motivo_cancelacion'] as string) ?? null,
      created_at: raw['created_at'] as string,
      fotos,
      eventos: ((raw['eventos'] as Array<Record<string, unknown>>) ?? []).map((e) => ({
        de: (e['de'] as string) ?? null,
        a: (e['a'] as string) ?? null,
        nota: (e['nota'] as string) ?? null,
        por: (e['por'] as string) ?? null,
        created_at: e['created_at'] as string,
      })),
    };
  }

  /** URL firmada de una foto del apoyo (bucket privado). Best-effort. */
  private async signFoto(path: string | null): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /**
   * CK12 — crea el apoyo OFFLINE por el outbox (idempotente por UUID de op). Las
   * fotos se persisten como borrador_fotos (durables, WebKit-safe) y el handler las
   * sube tras crear la solicitud. Devuelve el client id de la op.
   */
  async crear(input: CrearApoyoInput): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const clave = this.claveFotos(id);
    const fotoClientIds: string[] = [];
    // Persistir los blobs ANTES de encolar (si el SO mata entre medias, quedan
    // huérfanos inocuos; si encola, op + fotos quedan durables juntas).
    for (let i = 0; i < input.fotos.length; i++) {
      await this.borrador.saveFoto(clave, `foto_${i}`, input.fotos[i]);
      fotoClientIds.push(crypto.randomUUID());
    }
    await this.sync.enqueue({
      id,
      tipo_op: OP_CREAR,
      capturado_en,
      payload: {
        id,
        tipo_apoyo: input.tipoApoyo,
        proyecto_id: input.proyectoId,
        proyecto_nombre: input.proyectoNombre ?? null,
        dia: input.dia,
        descripcion: input.descripcion,
        destino_tipo: input.destinoTipo ?? null,
        destino_texto: input.destinoTexto ?? null,
        destino_bodega_id: input.destinoBodegaId ?? null,
        destino_proyecto_id: input.destinoProyectoId ?? null,
        es_danado: input.esDanado ?? false,
        foto_client_ids: fotoClientIds,
        capturado_en,
      },
      // Sin `fotos`: NO se pre-suben (el bucket exige folder=<solicitud_id>).
      resumen: { tipo: `apoyo_${input.tipoApoyo}`, descripcion: input.descripcion, capturado_en },
    });
    void this.invalidarListado();
    return id;
  }

  /**
   * CK13 — el solicitante (o el referente/elevado) cambia el estado del apoyo.
   * Offline por outbox (idempotente por op). El servidor valida la matriz de
   * transiciones por rol; sus mensajes humanos se muestran tal cual.
   */
  async cambiarEstado(solicitudId: string, estado: EstadoApoyo, nota: string | null = null): Promise<void> {
    const capturado_en = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: OP_ESTADO,
      capturado_en,
      payload: { id, solicitud_id: solicitudId, estado, nota: nota ?? null, capturado_en },
      resumen: { tipo: 'apoyo_estado', solicitud_id: solicitudId, estado, capturado_en },
    });
    await this.invalidarDetalle(solicitudId);
    void this.invalidarListado();
  }

  async invalidarListado(): Promise<void> {
    try {
      await this.catalog.invalidatePrefix(CAT_LISTADO);
    } catch {
      /* best-effort */
    }
  }
  async invalidarDetalle(id: string): Promise<void> {
    await this.catalog.invalidate(`apoyo_detalle:${id}`).catch(() => {});
  }

  private registerHandlers(): void {
    // CK12 — crear la solicitud, luego subir cada foto a su folder y referenciarla.
    this.sync.register(OP_CREAR, async (payload) => {
      const { data, error } = await this.supabase.client.rpc('apoyo_transporte_crear', {
        p_tipo_apoyo: payload['tipo_apoyo'],
        p_proyecto_id: payload['proyecto_id'],
        p_dia: payload['dia'] ?? null,
        p_descripcion: payload['descripcion'],
        p_destino_tipo: payload['destino_tipo'] ?? null,
        p_destino_texto: payload['destino_texto'] ?? null,
        p_destino_bodega_id: payload['destino_bodega_id'] ?? null,
        p_destino_proyecto_id: payload['destino_proyecto_id'] ?? null,
        p_es_danado: payload['es_danado'] ?? false,
        p_client_id: payload['id'],
      });
      if (error) throwSyncError(error);
      const solicitudId = data as string | null;
      if (!solicitudId) throw new Error('No se recibió el id del apoyo creado.');

      const clave = this.claveFotos(payload['id'] as string);
      const fotoIds = (payload['foto_client_ids'] as string[] | undefined) ?? [];
      const blobs = await this.borrador.loadFotos(clave);
      // Orden estable por índice de slot (foto_0, foto_1, …).
      const ordered = [...blobs].sort(
        (a, b) => Number(a.slot.replace('foto_', '')) - Number(b.slot.replace('foto_', '')),
      );
      for (let i = 0; i < ordered.length; i++) {
        const fotoClientId = fotoIds[i] ?? `${payload['id']}_foto_${i}`;
        const path = `${solicitudId}/${fotoClientId}.jpg`;
        const type = ordered[i].blob.type || 'image/jpeg';
        const { error: upErr } = await this.supabase.client.storage
          .from(BUCKET)
          .upload(path, ordered[i].blob, { upsert: true, contentType: type });
        if (upErr && !/exists/i.test(upErr.message)) throwSyncError(upErr);
        const { error: fErr } = await this.supabase.client.rpc('apoyo_transporte_agregar_foto', {
          p_solicitud_id: solicitudId,
          p_path: path,
          p_client_id: fotoClientId,
        });
        if (fErr) throwSyncError(fErr);
      }
      // Éxito total: suelta los blobs del borrador.
      await this.borrador.clearFotos(clave);
      void this.invalidarListado();
    });

    // CK13 — cambio de estado. Idempotente: si al drenar el apoyo YA está en el
    // estado final pedido (un reintento tras respuesta perdida), el 22023 "ya está
    // …" se trata como HECHO, no como error.
    this.sync.register(OP_ESTADO, async (payload) => {
      const { error } = await this.supabase.client.rpc('apoyo_transporte_cambiar_estado', {
        p_id: payload['solicitud_id'],
        p_estado: payload['estado'],
        p_nota: payload['nota'] ?? null,
        p_client_id: payload['id'],
      });
      if (error) {
        const yaAplicado =
          (error as { code?: string }).code === '22023' &&
          /ya est[áa]/i.test(error.message ?? '');
        if (!yaAplicado) throwSyncError(error);
      }
      void this.invalidarDetalle(payload['solicitud_id'] as string);
    });
  }
}
