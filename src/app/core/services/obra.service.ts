import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  ObraProyecto,
  PlanDelDia,
  NcAsignada,
  StockObraItem,
  ChecklistPlantilla,
  ChecklistItem,
  Subcontratista,
  Frente,
  CronogramaTarea,
  ResumenObra,
  CharlaCaptura,
  NcCaptura,
  IncidenteCaptura,
  ChecklistCaptura,
  CubicacionCaptura,
  PruebaCampoCaptura,
  ManoObraCaptura,
  PedidoUrgenteCaptura,
  EntradaProgramada,
  PedidoObra,
  AsignarTareaInput,
  AccionCorrectivaInput,
} from '../models/obra.model';

const BUCKET = 'obra';

/** Helper: photoPaths map ({slot→path}) → array of storage paths, filtered by prefix. */
function pathsFrom(photoPaths: Record<string, string>, prefix?: string): string[] {
  return Object.entries(photoPaths)
    .filter(([slot]) => !prefix || slot.startsWith(prefix))
    .map(([, path]) => path);
}

/**
 * AG16 — Gestión de Producción de Obra en la app (offline-first). Lecturas
 * cacheadas + capturas por outbox contra los RPCs de GESTION-OBRA.md §6.1. Todas
 * las fotos van al bucket `obra`. El servicio se inyecta en app.config.ts para
 * registrar sus handlers al arranque.
 */
@Injectable({ providedIn: 'root' })
export class ObraService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  // ── Lecturas ────────────────────────────────────────────────────────────────

  /** Mis obras (proyectos donde soy responsable o estoy asignado). */
  async misObras(): Promise<ObraProyecto[]> {
    const data = await this.catalog.refresh<ObraProyecto[]>('obra_mis_proyectos', async () => {
      const { data, error } = await this.supabase.client.rpc('mis_proyectos', { p_usuario: null });
      if (error) throw error;
      const arr = (data as Array<Record<string, unknown>>) ?? [];
      return arr.map((p) => ({
        id: p['id'] as string,
        nombre: p['nombre'] as string,
        codigo: (p['codigo'] as string) ?? null,
        estado: (p['estado'] as string) ?? null,
      }));
    });
    return data ?? [];
  }

  /** Plan del día de una obra (charla + tareas asignadas). */
  async planDelDia(proyectoId: string, fecha: string): Promise<PlanDelDia> {
    const key = `obra_plan:${proyectoId}:${fecha}`;
    const data = await this.catalog.refresh<PlanDelDia>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('plan_del_dia', {
        p_proyecto_id: proyectoId,
        p_fecha: fecha,
      });
      if (error) throw error;
      const d = (data as { charla: PlanDelDia['charla']; tareas: PlanDelDia['tareas'] }) ?? null;
      return { charla: d?.charla ?? null, tareas: d?.tareas ?? [] };
    });
    return data ?? { charla: null, tareas: [] };
  }

  /** Bandeja "Mis no conformidades / acciones" (auto-scoped por auth.uid()). */
  async misNcAsignadas(): Promise<NcAsignada[]> {
    const data = await this.catalog.refresh<NcAsignada[]>('obra_mis_nc', async () => {
      const { data, error } = await this.supabase.client.rpc('mis_nc_asignadas');
      if (error) throw error;
      return (data as NcAsignada[]) ?? [];
    });
    return data ?? [];
  }

  /** No conformidades de una obra (bandeja por obra, RLS-scoped + filtro cliente). */
  async ncDeObra(proyectoId: string): Promise<NcAsignada[]> {
    const { data, error } = await this.supabase.client
      .from('obra_no_conformidades')
      .select('id, proyecto_id, titulo, descripcion, estado, tipo, severidad, ubicacion, fotos, created_at')
      .eq('proyecto_id', proyectoId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data as unknown as NcAsignada[]) ?? [];
  }

  /** Stock de la obra (bodega principal), con nombre/unidad. */
  async stockDeObra(proyectoId: string): Promise<StockObraItem[]> {
    const key = `obra_stock:${proyectoId}`;
    const data = await this.catalog.refresh<StockObraItem[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('stock_de_obra', { p_proyecto_id: proyectoId });
      if (error) throw error;
      return (data as StockObraItem[]) ?? [];
    });
    return data ?? [];
  }

  /** Plantillas de checklist de calidad (categoria='calidad'). */
  async checklistPlantillas(): Promise<ChecklistPlantilla[]> {
    const data = await this.catalog.refresh<ChecklistPlantilla[]>('obra_cl_plantillas', async () => {
      const { data, error } = await this.supabase.client
        .from('cl_plantillas')
        .select('id, codigo, nombre, descripcion')
        .eq('categoria', 'calidad')
        .eq('activo', true)
        .order('orden');
      if (error) throw error;
      return (data as ChecklistPlantilla[]) ?? [];
    });
    return data ?? [];
  }

  /** Ítems de una plantilla de checklist. */
  async checklistItems(plantillaId: string): Promise<ChecklistItem[]> {
    const key = `obra_cl_items:${plantillaId}`;
    const data = await this.catalog.refresh<ChecklistItem[]>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('cl_plantilla_items')
        .select('id, seccion, etiqueta, orden')
        .eq('plantilla_id', plantillaId)
        .order('orden');
      if (error) throw error;
      return (data as ChecklistItem[]) ?? [];
    });
    return data ?? [];
  }

  /** Subcontratistas activos. */
  async subcontratistas(): Promise<Subcontratista[]> {
    const data = await this.catalog.refresh<Subcontratista[]>('obra_subcontratistas', async () => {
      const { data, error } = await this.supabase.client
        .from('obra_subcontratistas')
        .select('id, nombre, especialidad, contacto, telefono, activo')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return (data as Subcontratista[]) ?? [];
    });
    return data ?? [];
  }

  /** Informes de una obra. */
  async informesDeObra(proyectoId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.supabase.client.rpc('informes_de_obra', { p_proyecto_id: proyectoId });
    if (error) return [];
    return (data as Record<string, unknown>[]) ?? [];
  }

  /** FASE 6 — resumen del día del home de "Mi obra" (charla, tareas, NC, pedidos, avance). */
  async resumenDelDia(proyectoId: string, fecha: string): Promise<ResumenObra> {
    const [plan, misNc, nc, pedidos, avance] = await Promise.all([
      this.planDelDia(proyectoId, fecha),
      this.misNcAsignadas().catch(() => []),
      this.ncDeObra(proyectoId).catch(() => []),
      this.misPedidosObra(proyectoId).catch(() => []),
      this.avanceObra(proyectoId).catch(() => null),
    ]);
    const ncAbiertas = nc.filter((n) => n.estado === 'abierta' || n.estado === 'en_correccion').length;
    const pendiente = (e: string | null) => e !== 'cerrada' && e !== 'rechazada' && e !== 'despachada';
    return {
      charlaHecha: !!plan.charla,
      tareasHoy: plan.tareas.length,
      tareasPendientes: plan.tareas.filter((t) => t.estado !== 'completada' && t.estado !== 'cancelada').length,
      ncAbiertas,
      misPendientes: misNc.filter((n) => n.proyecto_id === proyectoId).length,
      pedidosPendientes: pedidos.filter((p) => pendiente(p.estado)).length,
      avanceReal: avance?.real ?? null,
      avancePlan: avance?.plan ?? null,
    };
  }

  /** Entradas programadas de materiales/equipos de la obra (Logística, FASE 5). */
  async entradasProgramadas(proyectoId: string): Promise<EntradaProgramada[]> {
    const { data, error } = await this.supabase.client.rpc('entradas_programadas_obra', { p_proyecto_id: proyectoId });
    if (error) return [];
    return (data as EntradaProgramada[]) ?? [];
  }

  /** Mis pedidos de la obra con su estado (seguimiento del pedido urgente, FASE 3). */
  async misPedidosObra(proyectoId: string): Promise<PedidoObra[]> {
    const { data, error } = await this.supabase.client.rpc('mis_pedidos_obra', { p_proyecto_id: proyectoId });
    if (error) return [];
    return (data as PedidoObra[]) ?? [];
  }

  /** Buscar usuarios para asignar (RPC security-definer; usuarios es admin-only RLS). */
  async buscarUsuarios(term: string): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: term });
    if (error) return [];
    return (data as { id: string; nombre: string }[]) ?? [];
  }

  /** Frentes de un subcontratista en una obra. */
  async frentesDe(subId: string, proyectoId: string): Promise<Frente[]> {
    const { data, error } = await this.supabase.client
      .from('obra_subcontratista_frentes')
      .select('id, descripcion, avance_pct, elemento_id, activo')
      .eq('subcontratista_id', subId)
      .eq('proyecto_id', proyectoId)
      .eq('activo', true);
    if (error) return [];
    return (data as unknown as Frente[]) ?? [];
  }

  /** Actualiza el % de avance de un frente (edición ligera, directa por RLS). */
  async actualizarFrenteAvance(frenteId: string, avancePct: number): Promise<void> {
    const { error } = await this.supabase.client
      .from('obra_subcontratista_frentes')
      .update({ avance_pct: avancePct })
      .eq('id', frenteId);
    if (error) throw new Error(error.message);
  }

  /** Tareas del cronograma de una obra (con % avance real). */
  async cronogramaTareas(proyectoId: string): Promise<CronogramaTarea[]> {
    const { data, error } = await this.supabase.client
      .from('cronograma_tareas')
      .select('id, nombre, estado, avance_pct, fase_id, orden')
      .eq('proyecto_id', proyectoId)
      .order('orden');
    if (error) return [];
    return (data as unknown as CronogramaTarea[]) ?? [];
  }

  /** Avance plan vs real de la obra (curva-S). */
  async avanceObra(proyectoId: string): Promise<{ plan: number; real: number } | null> {
    const { data, error } = await this.supabase.client.rpc('calcular_avance_obra', { p_proyecto_id: proyectoId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { plan: Number(row.avance_plan_pct) || 0, real: Number(row.avance_real_pct) || 0 };
  }

  /** Pruebas de campo recientes de una obra. */
  async pruebasDe(proyectoId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.supabase.client
      .from('obra_pruebas_campo')
      .select('id, tipo, fecha, resultado, notas, fotos')
      .eq('proyecto_id', proyectoId)
      .order('fecha', { ascending: false })
      .limit(30);
    if (error) return [];
    return (data as Record<string, unknown>[]) ?? [];
  }

  /** Compila (o recompila) el informe semanal de la obra para un período → id. */
  async compilarInforme(proyectoId: string, inicio: string, fin: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.rpc('compilar_informe_semanal', {
      p_proyecto_id: proyectoId,
      p_periodo_inicio: inicio,
      p_periodo_fin: fin,
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? null;
  }

  /** Guarda las secciones manuales del informe (online). */
  async guardarInformeManual(id: string, campos: Record<string, unknown>, contenido: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_informe_manual', {
      p_id: id,
      p_campos: campos,
      p_contenido: contenido,
    });
    if (error) throw new Error(error.message);
  }

  /** Envía el informe a Gerencia (in-app + push + email). */
  async enviarInforme(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('enviar_informe_semanal', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** Asignar una tarea del plan del día a un capataz/brigada (FASE 1, online). */
  async asignarTarea(input: AsignarTareaInput): Promise<void> {
    const { error } = await this.supabase.client.rpc('asignar_tarea_obra', {
      p_id: crypto.randomUUID(),
      p_proyecto_id: input.proyectoId,
      p_titulo: input.titulo,
      p_descripcion: input.descripcion,
      p_asignado_a: input.asignadoA,
      p_brigada: input.brigada,
      p_prioridad: input.prioridad,
      p_fecha_limite: input.fechaLimite,
    });
    if (error) throw new Error(error.message);
    await this.invalidarObra(input.proyectoId);
  }

  /** Asignar una acción correctiva sobre una NC/incidente (FASE 2, online). */
  async asignarAccionCorrectiva(input: AccionCorrectivaInput): Promise<void> {
    const { error } = await this.supabase.client.rpc('asignar_accion_correctiva', {
      p_id: crypto.randomUUID(),
      p_proyecto_id: input.proyectoId,
      p_origen_tipo: input.origenTipo,
      p_origen_id: input.origenId,
      p_descripcion: input.descripcion,
      p_responsable_id: input.responsableId,
      p_fecha_compromiso: input.fechaCompromiso,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate('obra_mis_nc');
  }

  // ── Escrituras (outbox) ──────────────────────────────────────────────────────

  /** Charla de seguridad (fotos del grupo + firmas). */
  async enqueueCharla(input: CharlaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = [
      ...input.fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `charla/${id}/foto_${i}.jpg`, slot: `foto_${i}`, blob })),
      ...input.firmas.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `charla/${id}/firma_${i}.png`, slot: `firma_${i}`, blob })),
    ];
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_charla',
      payload: {
        id, proyecto_id: input.proyectoId, fecha: input.fecha, tema: input.tema,
        duracion_min: input.duracionMin, asistentes: input.asistentes, notas: input.notas,
      },
      fotos,
      resumen: { tema: input.tema, fecha: input.fecha },
    });
  }

  /** Levantar no conformidad (foto(s) obligatoria(s)). */
  async enqueueNc(input: NcCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = input.fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `nc/${id}/foto_${i}.jpg`, slot: `foto_${i}`, blob }));
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_nc',
      payload: {
        id, proyecto_id: input.proyectoId, tipo: input.tipo, titulo: input.titulo,
        descripcion: input.descripcion, severidad: input.severidad, ubicacion: input.ubicacion,
        responsable_id: input.responsableId, bloquea_vaciado: input.bloqueaVaciado,
      },
      fotos,
      resumen: { titulo: input.titulo, tipo: input.tipo },
    });
  }

  /** Registrar incidente / casi-accidente. */
  async enqueueIncidente(input: IncidenteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = input.fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `incidente/${id}/foto_${i}.jpg`, slot: `foto_${i}`, blob }));
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_incidente',
      payload: {
        id, proyecto_id: input.proyectoId, tipo: input.tipo, descripcion: input.descripcion,
        gravedad: input.gravedad, lesionados: input.lesionados, ubicacion: input.ubicacion,
        investigacion: input.investigacion,
      },
      fotos,
      resumen: { tipo: input.tipo, gravedad: input.gravedad },
    });
  }

  /** Marcar una acción correctiva como hecha (con evidencia). */
  async enqueueAccionHecha(accionId: string, fotos: Blob[]): Promise<void> {
    const foto = fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `accion/${accionId}/ev_${i}.jpg`, slot: `ev_${i}`, blob }));
    await this.sync.enqueue({
      id: `accion_hecha_${accionId}`,
      tipo_op: 'obra_accion_hecha',
      payload: { accion_id: accionId },
      fotos: foto,
      resumen: { accion_id: accionId },
    });
  }

  /** Verificar y cerrar una NC. */
  async enqueueVerificarNc(ncId: string, nota: string | null): Promise<void> {
    await this.sync.enqueue({
      id: `nc_verificar_${ncId}`,
      tipo_op: 'obra_nc_verificar',
      payload: { nc_id: ncId, nota },
      fotos: [],
      resumen: { nc_id: ncId },
    });
  }

  /** Ejecutar un checklist de calidad (respuestas + fotos + observaciones). */
  async enqueueChecklist(input: ChecklistCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = input.fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `checklist/${id}/foto_${i}.jpg`, slot: `foto_${i}`, blob }));
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_checklist',
      payload: {
        id, plantilla_id: input.plantillaId, proyecto_id: input.proyectoId,
        respuestas: input.respuestas, observaciones: input.observaciones,
      },
      fotos,
      resumen: { plantilla_id: input.plantillaId },
    });
  }

  /** Cargar una cubicación (borrador) con soportes. */
  async enqueueCubicacion(input: CubicacionCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = input.soportes.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `cubicacion/${id}/sop_${i}.jpg`, slot: `sop_${i}`, blob }));
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_cubicacion',
      payload: {
        id, subcontratista_id: input.subcontratistaId, proyecto_id: input.proyectoId,
        periodo_inicio: input.periodoInicio, periodo_fin: input.periodoFin,
        descripcion: input.descripcion, monto: input.monto, avance_pct: input.avancePct,
      },
      fotos,
      resumen: { monto: input.monto, avance_pct: input.avancePct },
    });
  }

  /** Reportar % de avance de una tarea del cronograma. */
  async enqueueAvanceTarea(tareaId: string, avancePct: number): Promise<void> {
    await this.sync.enqueue({
      id: `avance_${tareaId}_${Date.now()}`,
      tipo_op: 'obra_avance_tarea',
      payload: { tarea_id: tareaId, avance_pct: avancePct },
      fotos: [],
      resumen: { tarea_id: tareaId, avance_pct: avancePct },
    });
  }

  /** Registrar una prueba de campo (slump, probeta…). */
  async enqueuePruebaCampo(input: PruebaCampoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const fotos = input.fotos.map((blob, i) => ({ id: crypto.randomUUID(), bucket: BUCKET, path: `prueba/${id}/foto_${i}.jpg`, slot: `foto_${i}`, blob }));
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_prueba_campo',
      payload: {
        id, proyecto_id: input.proyectoId, tipo: input.tipo, fecha: input.fecha,
        resultado: input.resultado, notas: input.notas,
      },
      fotos,
      resumen: { tipo: input.tipo, fecha: input.fecha },
    });
  }

  /** Registrar el parte de mano de obra del día. */
  async enqueueManoObra(input: ManoObraCaptura): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_mano_obra',
      payload: {
        id, proyecto_id: input.proyectoId, fecha: input.fecha, actividad: input.actividad,
        cantidad_trabajadores: input.cantidadTrabajadores, horas: input.horas, notas: input.notas,
      },
      fotos: [],
      resumen: { actividad: input.actividad, fecha: input.fecha },
    });
  }

  /** Pedido urgente de material (requisición urgente). */
  async enqueuePedidoUrgente(input: PedidoUrgenteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'obra_pedido_urgente',
      payload: { id, proyecto_id: input.proyectoId, notas: input.notas, items: input.items },
      fotos: [],
      resumen: { items: input.items.length },
    });
  }

  // ── Handlers del outbox ──────────────────────────────────────────────────────

  private registerHandlers(): void {
    this.sync.register('obra_charla', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_charla_seguridad', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_fecha: payload['fecha'],
        p_tema: payload['tema'],
        p_duracion_min: payload['duracion_min'] ?? 5,
        p_notas: payload['notas'] ?? null,
        p_asistentes: payload['asistentes'] ?? null,
        p_fotos: pathsFrom(photoPaths, 'foto_'),
        p_firmas: pathsFrom(photoPaths, 'firma_'),
      });
      if (error) throwSyncError(error);
      await this.invalidarObra(payload['proyecto_id'] as string);
    });

    this.sync.register('obra_nc', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('levantar_nc', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_tipo: payload['tipo'],
        p_titulo: payload['titulo'],
        p_descripcion: payload['descripcion'],
        p_severidad: payload['severidad'] ?? 'media',
        p_ubicacion: payload['ubicacion'] ?? null,
        p_responsable_id: payload['responsable_id'] ?? null,
        p_fotos: pathsFrom(photoPaths),
        p_bloquea_vaciado: payload['bloquea_vaciado'] ?? false,
      });
      if (error) throwSyncError(error);
      await this.invalidarObra(payload['proyecto_id'] as string);
      await this.catalog.invalidate('obra_mis_nc');
    });

    this.sync.register('obra_incidente', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_incidente_obra', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_tipo: payload['tipo'],
        p_descripcion: payload['descripcion'],
        p_gravedad: payload['gravedad'] ?? 'media',
        p_lesionados: payload['lesionados'] ?? 0,
        p_ubicacion: payload['ubicacion'] ?? null,
        p_investigacion: payload['investigacion'] ?? null,
        p_fotos: pathsFrom(photoPaths),
      });
      if (error) throwSyncError(error);
      await this.invalidarObra(payload['proyecto_id'] as string);
    });

    this.sync.register('obra_accion_hecha', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('marcar_accion_hecha', {
        p_accion_id: payload['accion_id'],
        p_evidencia_fotos: pathsFrom(photoPaths),
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate('obra_mis_nc');
    });

    this.sync.register('obra_nc_verificar', async (payload) => {
      const { error } = await this.supabase.client.rpc('verificar_cerrar_nc', {
        p_nc_id: payload['nc_id'],
        p_nota: payload['nota'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate('obra_mis_nc');
    });

    this.sync.register('obra_checklist', async (payload, photoPaths) => {
      const fotos = pathsFrom(photoPaths).map((p) => ({ storage_path: p, correcto: null, descripcion: null }));
      const { error } = await this.supabase.client.rpc('ejecutar_checklist_calidad', {
        p_id: payload['id'],
        p_plantilla_id: payload['plantilla_id'],
        p_proyecto_id: payload['proyecto_id'],
        p_respuestas: payload['respuestas'],
        p_fotos: fotos,
        p_observaciones: payload['observaciones'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('obra_cubicacion', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('crear_cubicacion', {
        p_id: payload['id'],
        p_subcontratista_id: payload['subcontratista_id'],
        p_proyecto_id: payload['proyecto_id'],
        p_periodo_inicio: payload['periodo_inicio'],
        p_periodo_fin: payload['periodo_fin'],
        p_descripcion: payload['descripcion'],
        p_monto: payload['monto'],
        p_avance_pct: payload['avance_pct'],
        p_soportes: pathsFrom(photoPaths),
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('obra_avance_tarea', async (payload) => {
      const { error } = await this.supabase.client.rpc('reportar_avance_tarea', {
        p_tarea_id: payload['tarea_id'],
        p_avance_pct: payload['avance_pct'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('obra_prueba_campo', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_prueba_campo', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_tipo: payload['tipo'],
        p_fecha: payload['fecha'],
        p_resultado: payload['resultado'] ?? null,
        p_notas: payload['notas'] ?? null,
        p_fotos: pathsFrom(photoPaths),
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('obra_mano_obra', async (payload) => {
      const { error } = await this.supabase.client.rpc('registrar_mano_obra', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_fecha: payload['fecha'],
        p_actividad: payload['actividad'],
        p_cantidad_trabajadores: payload['cantidad_trabajadores'],
        p_horas: payload['horas'],
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('obra_pedido_urgente', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_solicitud_app', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_urgencia: 'urgente',
        p_notas: payload['notas'],
        p_items: payload['items'],
      });
      if (error) throwSyncError(error);
    });
  }

  private async invalidarObra(proyectoId: string): Promise<void> {
    await this.catalog.invalidatePrefix(`obra_plan:${proyectoId}`);
  }
}
