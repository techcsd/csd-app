import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  TecEquipo,
  TecTipo,
  TecEquipoCaptura,
  TecEquipoEstado,
  TecEquipoCondicion,
  TecKitEstado,
} from '../models/tecnologia.model';

const CATALOG_EQUIPOS = 'tec_equipos';
const CATALOG_TIPOS = 'tec_equipo_tipos';
const CATALOG_ESTADOS = 'tec_equipo_estados';
const CATALOG_CONDICIONES = 'tec_equipo_condiciones';
const BUCKET = 'inventario';
const GARANTIA_ALERTA_DIAS_DEFAULT = 30;

/**
 * AL2/DA — Inventario tecnológico en la app. Lecturas por tabla directa (RLS deja
 * leer a autenticados), cacheadas offline. Escrituras por OUTBOX:
 *  - Campos base (nombre/tipo/bodega/costo/marca/modelo/serie/estado/notas/fotos)
 *    → RPC `guardar_tec_equipo_app` (idempotente, código/historial los pone la BD).
 *  - Campos nuevos de la ronda DA (condición, identificación, specs, responsable
 *    externo, costo_origen, "desconocida", fotos_specs) → directo a
 *    `tec_equipos`/`tec_equipo_specs` DENTRO del mismo handler de outbox (mismo
 *    patrón que otros ~85 handlers de esta app que ya escriben directo a tabla
 *    durante el sync — "nunca directo" es sobre la UI, no sobre el handler). No
 *    existe (ni se inventa aquí) una RPC "_app" que ya cubra estos campos; las
 *    RPC "_asistente" de DA5 son del conector de Claude (stampan "Cargado por
 *    Claude." por defecto) y no se reusan para no arrastrar ese efecto.
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
        .select('id, clave, label, orden, activo, grupos_campos')
        .eq('activo', true)
        .order('orden')
        .order('label');
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Omit<TecTipo, 'grupos_campos'> & { grupos_campos: string[] | null }>).map((t) => ({
        ...t,
        grupos_campos: t.grupos_campos ?? [],
      }));
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
      .select('id, clave, label, orden, activo, grupos_campos')
      .single();
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_TIPOS);
    return { ...(data as TecTipo), grupos_campos: (data as { grupos_campos: string[] | null }).grupos_campos ?? [] };
  }

  // ── DA7/DA-04 — situación y condición, catálogo (igual patrón que tipos) ────
  async getEstados(): Promise<TecEquipoEstado[]> {
    const data = await this.catalog.refresh<TecEquipoEstado[]>(CATALOG_ESTADOS, async () => {
      const { data, error } = await this.supabase.client
        .from('tec_equipo_estados')
        .select('id, clave, label, orden, activo')
        .eq('activo', true)
        .order('orden');
      if (error) throw new Error(error.message);
      return (data as TecEquipoEstado[]) ?? [];
    });
    return data ?? [];
  }

  async getCondiciones(): Promise<TecEquipoCondicion[]> {
    const data = await this.catalog.refresh<TecEquipoCondicion[]>(CATALOG_CONDICIONES, async () => {
      const { data, error } = await this.supabase.client
        .from('tec_equipo_condiciones')
        .select('id, clave, label, orden, activo')
        .eq('activo', true)
        .order('orden');
      if (error) throw new Error(error.message);
      return (data as TecEquipoCondicion[]) ?? [];
    });
    return data ?? [];
  }

  // ── Equipos ──────────────────────────────────────────────────────────────────
  async getEquipos(): Promise<TecEquipo[]> {
    const data = await this.catalog.refresh<TecEquipo[]>(CATALOG_EQUIPOS, async () => {
      const { data, error } = await this.supabase.client
        .from('tec_equipos')
        .select('*, specs:tec_equipo_specs(*)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const raw = (data ?? []) as Array<TecEquipo & { specs: TecEquipo['specs'] | TecEquipo['specs'][] }>;
      const equipos = raw.map((e) => ({ ...e, specs: Array.isArray(e.specs) ? (e.specs[0] ?? null) : (e.specs ?? null) })) as TecEquipo[];
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

  /** DA-10 — componentes de un kit (derivado del mismo cache, sin red aparte). */
  async getComponentes(kitId: string): Promise<TecEquipo[]> {
    return (await this.getEquipos()).filter((e) => e.kit_padre_id === kitId);
  }

  /** DA-10 — estado calculado del kit (mismo criterio que la vista tec_kits_estado). */
  kitEstadoDe(componentes: TecEquipo[]): TecKitEstado {
    const presentes = componentes.filter((c) => c.presente).length;
    return {
      totalComponentes: componentes.length,
      presentes,
      faltantes: componentes.length - presentes,
      completo: componentes.length > 0 && presentes === componentes.length,
    };
  }

  /** DA-18 — días de alerta de garantía (sgc.parametros, best-effort — default 30). */
  async getGarantiaAlertaDias(): Promise<number> {
    const data = await this.catalog.refresh<number>('tec_garantia_alerta_dias', async () => {
      const { data, error } = await this.supabase.client
        .from('parametros')
        .select('valor')
        .eq('clave', 'tec_garantia_alerta_dias')
        .maybeSingle();
      if (error || !data?.valor) return GARANTIA_ALERTA_DIAS_DEFAULT;
      const n = parseInt(data.valor, 10);
      return Number.isFinite(n) && n > 0 ? n : GARANTIA_ALERTA_DIAS_DEFAULT;
    });
    return data ?? GARANTIA_ALERTA_DIAS_DEFAULT;
  }

  /** DA-18 — ¿la garantía de este equipo vence dentro de la ventana de alerta? */
  garantiaPorVencer(e: TecEquipo, diasAlerta: number): boolean {
    if (e.garantia_desconocida || !e.garantia_hasta) return false;
    const hasta = new Date(e.garantia_hasta + 'T00:00:00');
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((hasta.getTime() - hoy.getTime()) / 86_400_000);
    return dias >= 0 && dias <= diasAlerta;
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

  // ── DA-10 — Kits: mover kit completo / soltar o mover una pieza (online) ────
  /**
   * Mueve el kit completo (cascada a componentes presentes, DA3). `empleadoId`
   * por defecto es EL ACTUAL del kit (la app no tiene picker de empleado para
   * equipos todavía — evita desasignar por accidente al solo cambiar de bodega).
   */
  async moverKit(kit: TecEquipo, opts: { bodegaId: string | null; ubicacion: string | null; motivo?: string }): Promise<void> {
    const { error } = await this.supabase.client.rpc('tec_kit_mover', {
      p_kit_id: kit.id,
      p_empleado_id: kit.empleado_id,
      p_bodega_id: opts.bodegaId,
      p_ubicacion: opts.ubicacion,
      p_motivo: opts.motivo ?? null,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_EQUIPOS);
  }

  /** Quita una pieza del kit (pasa a equipo suelto) o la mueve de dueño/bodega sin sacarla. */
  async moverPieza(
    componenteId: string,
    opts: { quitarDelKit?: boolean; empleadoId?: string | null; bodegaId?: string | null; motivo?: string },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('tec_kit_mover_pieza', {
      p_componente_id: componenteId,
      p_quitar_del_kit: opts.quitarDelKit ?? false,
      p_empleado_id: opts.empleadoId ?? null,
      p_bodega_id: opts.bodegaId ?? null,
      p_motivo: opts.motivo ?? null,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_EQUIPOS);
  }

  /** Marca una pieza presente/faltante dentro del kit (online, directo a tabla — igual RLS que la web). */
  async marcarPresente(componenteId: string, presente: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('tec_equipos').update({ presente }).eq('id', componenteId);
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_EQUIPOS);
  }

  // ── Alta/edición — offline por outbox ───────────────────────────────────────
  async enqueueGuardar(c: TecEquipoCaptura): Promise<void> {
    const id = c.id ?? crypto.randomUUID();
    const fotos = c.fotosNuevas.map((f) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `tec-equipo/${id}/${f.key}.jpg`,
      slot: f.key,
      blob: f.blob,
    }));
    const fotosSpecs = c.fotosSpecsNuevas.map((f) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `tec-equipo/${id}/specs/${f.key}.jpg`,
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
        // DA — campos nuevos
        condicion: c.condicion,
        responsable_externo: c.responsableExterno,
        costo_origen: c.costoOrigen,
        fecha_compra: c.fechaCompra,
        fecha_compra_desconocida: c.fechaCompraDesconocida,
        garantia_hasta: c.garantiaHasta,
        garantia_desconocida: c.garantiaDesconocida,
        service_tag: c.serviceTag,
        codigo_servicio: c.codigoServicio,
        numero_parte: c.numeroParte,
        modelo_regulatorio: c.modeloRegulatorio,
        anio_fabricacion: c.anioFabricacion,
        codigo_anterior: c.codigoAnterior,
        imei: c.imei,
        etiqueta_taller: c.etiquetaTaller,
        fotos_specs_existentes: c.fotosSpecsExistentes,
        fotos_specs_nuevos_keys: c.fotosSpecsNuevas.map((f) => f.key),
        specs: c.specs,
      },
      fotos: [...fotos, ...fotosSpecs],
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

      // DA — campos nuevos: directo a tec_equipos (mismo RLS que guardar_tec_equipo_app
      // ya pasó arriba; el id ya existe en la tabla a esta altura, recién creado o editado).
      const equipoId = payload['id'] as string;
      const existentesSpecsFotos = (payload['fotos_specs_existentes'] as string[]) ?? [];
      const nuevosSpecsKeys = (payload['fotos_specs_nuevos_keys'] as string[]) ?? [];
      const nuevosSpecsPaths = nuevosSpecsKeys.map((k) => photoPaths[k]).filter((p): p is string => !!p);
      const fotosSpecs = [...existentesSpecsFotos, ...nuevosSpecsPaths];

      const { error: errCampos } = await this.supabase.client
        .from('tec_equipos')
        .update({
          condicion: payload['condicion'] ?? 'funciona',
          responsable_externo: payload['responsable_externo'] ?? null,
          costo_origen: payload['costo_origen'] ?? 'compra',
          fecha_compra: payload['fecha_compra'] ?? null,
          fecha_compra_desconocida: !!payload['fecha_compra_desconocida'],
          garantia_hasta: payload['garantia_hasta'] ?? null,
          garantia_desconocida: !!payload['garantia_desconocida'],
          service_tag: payload['service_tag'] ?? null,
          codigo_servicio: payload['codigo_servicio'] ?? null,
          numero_parte: payload['numero_parte'] ?? null,
          modelo_regulatorio: payload['modelo_regulatorio'] ?? null,
          anio_fabricacion: payload['anio_fabricacion'] ?? null,
          codigo_anterior: payload['codigo_anterior'] ?? null,
          imei: payload['imei'] ?? null,
          etiqueta_taller: payload['etiqueta_taller'] ?? null,
          fotos_specs: fotosSpecs,
        })
        .eq('id', equipoId);
      if (errCampos) throwSyncError(errCampos);

      const specs = payload['specs'] as Record<string, unknown> | null;
      if (specs && Object.keys(specs).length > 0) {
        const { error: errSpecs } = await this.supabase.client
          .from('tec_equipo_specs')
          .upsert({ equipo_id: equipoId, ...specs }, { onConflict: 'equipo_id' });
        if (errSpecs) throwSyncError(errSpecs);
      }

      await this.catalog.invalidate(CATALOG_EQUIPOS);
    });
  }
}
