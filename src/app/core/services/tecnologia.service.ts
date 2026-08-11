import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { TecEquipo, TecTipo, TecEquipoCaptura } from '../models/tecnologia.model';

const CATALOG_EQUIPOS = 'tec_equipos';
const CATALOG_TIPOS = 'tec_equipo_tipos';
const BUCKET = 'inventario';

/**
 * AL2 — Inventario tecnológico en la app. Lecturas por tabla directa (RLS deja
 * leer a autenticados), cacheadas offline. Escrituras por OUTBOX → RPC
 * guardar_tec_equipo_app (idempotente, genera código, gate admin|tecnologia).
 */
@Injectable({ providedIn: 'root' })
export class TecnologiaService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  // ── Tipos (catálogo administrable) ──────────────────────────────────────────
  async getTipos(): Promise<TecTipo[]> {
    const data = await this.catalog.refresh<TecTipo[]>(CATALOG_TIPOS, async () => {
      const { data, error } = await this.supabase.client
        .from('tec_equipo_tipos')
        .select('id, clave, label, orden, activo')
        .eq('activo', true)
        .order('orden')
        .order('label');
      if (error) throw new Error(error.message);
      return (data as TecTipo[]) ?? [];
    });
    return data ?? [];
  }

  /** Alta de un tipo nuevo (online; requiere admin|tecnologia por RLS). */
  async addTipo(label: string): Promise<TecTipo> {
    const clave =
      label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z0-9]+/g, '_') // NFD deja los acentos como marcas → caen aquí
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || `tipo_${Date.now()}`;
    const { data, error } = await this.supabase.client
      .from('tec_equipo_tipos')
      .insert({ clave, label: label.trim(), orden: 200 })
      .select('id, clave, label, orden, activo')
      .single();
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_TIPOS);
    return data as TecTipo;
  }

  // ── Equipos ──────────────────────────────────────────────────────────────────
  async getEquipos(): Promise<TecEquipo[]> {
    const data = await this.catalog.refresh<TecEquipo[]>(CATALOG_EQUIPOS, async () => {
      const { data, error } = await this.supabase.client
        .from('tec_equipos')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const equipos = (data as TecEquipo[]) ?? [];
      // AN1 (PROMPT-7 FASE 1) — el nombre del "Asignado a" se resuelve por el
      // directorio de referencia, NO por embed a `empleados`: esa tabla tiene RLS
      // restrictiva (own OR rrhh), así que el rol Tecnología (sin módulo rrhh) veía
      // el nombre en null. directorio_empleados() es security-definer y legible por
      // cualquier autenticado. Best-effort: si falla, el equipo igual carga.
      if (equipos.some((e) => e.empleado_id)) {
        try {
          const { data: dir } = await this.supabase.client.rpc('directorio_empleados');
          const map = new Map<string, NonNullable<TecEquipo['empleado']>>();
          for (const r of (dir as Array<{ id: string; nombre: string; apellido: string | null; cargo: string | null }>) ?? []) {
            map.set(r.id, { nombre: r.nombre, apellido: r.apellido, cargo: r.cargo });
          }
          for (const e of equipos) e.empleado = e.empleado_id ? (map.get(e.empleado_id) ?? null) : null;
        } catch {
          /* best-effort: sin nombres, el equipo igual carga */
        }
      }
      return equipos;
    });
    return data ?? [];
  }

  async getEquipo(id: string): Promise<TecEquipo | null> {
    return (await this.getEquipos()).find((e) => e.id === id) ?? null;
  }

  /** URL firmada de una foto (bucket inventario, best-effort). */
  async fotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Alta/edición de un equipo — offline-safe por outbox, idempotente por id. */
  async enqueueGuardar(c: TecEquipoCaptura): Promise<void> {
    const id = c.id ?? crypto.randomUUID();
    const fotos = c.fotosNuevas.map((f) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `tec-equipo/${id}/${f.key}.jpg`,
      slot: f.key,
      blob: f.blob,
    }));
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'tec_equipo_guardar',
      capturado_en: new Date().toISOString(),
      payload: {
        id,
        nombre: c.nombre,
        tipo_id: c.tipoId,
        bodega_id: c.bodegaId,
        costo: c.costo,
        moneda: c.moneda,
        marca: c.marca,
        modelo: c.modelo,
        serie: c.serie,
        estado: c.estado,
        notas: c.notas,
        fotos_existentes: c.fotosExistentes,
        nuevos_keys: c.fotosNuevas.map((f) => f.key),
        portada_key: c.portadaKey,
      },
      fotos,
      resumen: { nombre: c.nombre, edicion: !!c.id },
    });
    await this.catalog.invalidate(CATALOG_EQUIPOS);
  }

  private registerHandler(): void {
    this.sync.register('tec_equipo_guardar', async (payload, photoPaths) => {
      const existentes = (payload['fotos_existentes'] as string[]) ?? [];
      const nuevosKeys = (payload['nuevos_keys'] as string[]) ?? [];
      const nuevosPaths = nuevosKeys.map((k) => photoPaths[k]).filter((p): p is string => !!p);
      const fotos = [...existentes, ...nuevosPaths];
      const portadaKey = (payload['portada_key'] as string | null) ?? null;
      let portada: string | null = null;
      if (portadaKey) {
        portada = existentes.includes(portadaKey) ? portadaKey : (photoPaths[portadaKey] ?? null);
      }
      portada = portada ?? fotos[0] ?? null;

      const { error } = await this.supabase.client.rpc('guardar_tec_equipo_app', {
        p_id: payload['id'],
        p_nombre: payload['nombre'],
        p_tipo_id: payload['tipo_id'] ?? null,
        p_bodega_id: payload['bodega_id'] ?? null,
        p_costo: payload['costo'] ?? null,
        p_moneda: payload['moneda'] ?? 'DOP',
        p_marca: payload['marca'] ?? null,
        p_modelo: payload['modelo'] ?? null,
        p_serie: payload['serie'] ?? null,
        p_estado: payload['estado'] ?? 'en_stock',
        p_notas: payload['notas'] ?? null,
        p_fotos: fotos,
        p_foto_portada: portada,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(CATALOG_EQUIPOS);
    });
  }
}
