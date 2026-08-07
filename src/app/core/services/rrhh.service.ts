import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';

/** AH16 — empleado (RRHH). Campos de consulta/ficha para la app. */
export interface Empleado {
  id: string;
  cedula: string | null;
  nombre: string | null;
  apellido: string | null;
  cargo: string | null;
  departamento: string | null;
  telefono: string | null;
  email: string | null;
  fecha_ingreso: string | null;
  tipo_contrato: string | null;
  activo: boolean;
}

/** AF33 — un item asignado a un empleado. */
export type AsignacionEstado = 'asignado' | 'devuelto' | 'perdido' | 'dañado';
export type AsignacionItemTipo = 'activo_fijo' | 'articulo' | 'libre';
export interface Asignacion {
  id: string;
  empleado_id: string;
  item_tipo: AsignacionItemTipo;
  item_id: string | null;
  item_nombre: string;
  categoria: string | null;
  foto_path: string | null;
  estado: AsignacionEstado;
  asignado_en: string | null;
  devuelto_en: string | null;
  notas: string | null;
}

/** AH16 — datos para registrar una asignación de item a un empleado. */
export interface AsignarCaptura {
  empleadoId: string;
  itemNombre: string;
  itemTipo: AsignacionItemTipo;
  categoria: string | null;
  notas: string | null;
  foto: Blob | null;
}

const EMP_SELECT =
  'id, cedula, nombre, apellido, cargo, departamento, telefono, email, fecha_ingreso, tipo_contrato, activo';
const ASIG_SELECT =
  'id, empleado_id, item_tipo, item_id, item_nombre, categoria, foto_path, estado, asignado_en, devuelto_en, notas';
const AUDIT_BUCKET_RRHH = 'sgc-rrhh';

/**
 * AH16 — RRHH en la app (para el rol jefe de RRHH). Consulta de empleados + ficha
 * y asignaciones de items (AF33): registrar/devolver desde el teléfono. Lecturas
 * cache-then-network (RLS scopea por módulo 'rrhh'); escrituras por outbox → RPCs
 * `asignar_item_empleado` / `cambiar_estado_asignacion`.
 */
@Injectable({ providedIn: 'root' })
export class RrhhService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  async empleados(): Promise<Empleado[]> {
    const data = await this.catalog.refresh<Empleado[]>('rrhh_empleados', async () => {
      const { data, error } = await this.supabase.client
        .from('empleados')
        .select(EMP_SELECT)
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as unknown as Empleado[]) ?? [];
    });
    return data ?? [];
  }

  async empleado(id: string): Promise<Empleado | null> {
    const cached = (await this.catalog.read<Empleado[]>('rrhh_empleados')) ?? [];
    const local = cached.find((e) => e.id === id) ?? null;
    const { data, error } = await this.supabase.client.from('empleados').select(EMP_SELECT).eq('id', id).maybeSingle();
    if (error || !data) return local;
    return data as unknown as Empleado;
  }

  async asignacionesDe(empleadoId: string): Promise<Asignacion[]> {
    const { data, error } = await this.supabase.client
      .from('empleado_asignaciones')
      .select(ASIG_SELECT)
      .eq('empleado_id', empleadoId)
      .order('asignado_en', { ascending: false });
    if (error) return [];
    return (data as unknown as Asignacion[]) ?? [];
  }

  /** AF33 — registrar una asignación (offline-safe). Foto opcional (bucket sgc-rrhh). */
  async enqueueAsignar(input: AsignarCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (input.foto) {
      fotos.push({ id: crypto.randomUUID(), bucket: AUDIT_BUCKET_RRHH, path: `asignaciones/${input.empleadoId}/${id}.jpg`, slot: 'asig_foto', blob: input.foto });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'rrhh_asignar_item',
      capturado_en,
      payload: {
        empleado_id: input.empleadoId,
        item_nombre: input.itemNombre,
        item_tipo: input.itemTipo,
        categoria: input.categoria,
        notas: input.notas,
      },
      fotos,
      resumen: { tipo: 'rrhh_asignar_item', empleado_id: input.empleadoId, capturado_en },
    });
  }

  /** AF33 — cambiar el estado de una asignación (devuelto/perdido/dañado). Offline-safe. */
  async enqueueCambiarEstado(asignacionId: string, estado: AsignacionEstado, nota: string | null): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'rrhh_asignacion_estado',
      capturado_en,
      payload: { asignacion_id: asignacionId, estado, nota },
      fotos: [],
      resumen: { tipo: 'rrhh_asignacion_estado', asignacion_id: asignacionId, capturado_en },
    });
  }

  private registerHandler(): void {
    this.sync.register('rrhh_asignar_item', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('asignar_item_empleado', {
        p_empleado_id: payload['empleado_id'],
        p_item_nombre: payload['item_nombre'],
        p_item_tipo: payload['item_tipo'] ?? 'libre',
        p_item_id: null,
        p_categoria: payload['categoria'] ?? null,
        p_foto_path: photoPaths['asig_foto'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('rrhh_asignacion_estado', async (payload) => {
      const { error } = await this.supabase.client.rpc('cambiar_estado_asignacion', {
        p_asignacion_id: payload['asignacion_id'],
        p_estado: payload['estado'],
        p_nota: payload['nota'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
