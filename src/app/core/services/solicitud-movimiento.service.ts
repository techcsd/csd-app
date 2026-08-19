import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SyncService } from '../sync/sync.service';

/** AY11 — prioridad de una solicitud de movimiento (color/badge, no todo rojo — AY3). */
export type PrioridadSolicitud = 'baja' | 'media' | 'alta' | 'urgente';

/** AY11 — estado del ciclo: pendiente → planificada → en_curso → completada / cancelada. */
export type EstadoSolicitud = 'pendiente' | 'planificada' | 'en_curso' | 'completada' | 'cancelada';

/** AY11 — una fila de solicitudes_movimiento_listar (aplanada para la UI). */
export interface SolicitudMovimiento {
  id: string;
  solicitante: string | null;
  proyecto_id: string | null;
  proyecto: string | null;
  que_se_mueve: string;
  tipo_carga: string | null;
  origen: string | null;
  destino: string | null;
  prioridad: PrioridadSolicitud;
  estado: EstadoSolicitud;
  fecha_solicitud: string;
  fecha_requerimiento: string | null;
  notas: string | null;
  ruta_id: string | null;
  conductor: string | null;
  es_prueba: boolean;
  /** Días hasta la fecha de requerimiento (negativo = vencida). Para el semáforo. */
  dias_para_requerimiento: number | null;
  created_at: string;
}

/** AY11 — filtros de la bandeja del referente. */
export interface FiltrosSolicitud {
  estado?: EstadoSolicitud | null;
  proyectoId?: string | null;
  prioridad?: PrioridadSolicitud | null;
  desde?: string | null;
  hasta?: string | null;
}

/** AY11 — input del formulario de creación (ingeniero). */
export interface CrearSolicitudInput {
  proyectoId: string;
  queSeMueve: string;
  tipoCarga: string;
  origenTexto: string;
  destinoTexto: string;
  prioridad: PrioridadSolicitud;
  fechaRequerimiento: string | null;
  notas: string | null;
}

const OP_CREAR = 'solicitud_movimiento_crear';

/**
 * AY11 — Solicitud de movimiento (logística de transporte). Un ingeniero pide al
 * departamento de transporte mover material/equipo; los roles referentes (jefe de
 * flota, guarda almacén, logística, compras, gerencia — resueltos SERVER-SIDE por
 * es_referente_movimiento()) ven la bandeja completa y planifican creando una ruta.
 *
 * La creación va por OUTBOX (offline-first, ADR-002). Planificar/completar/cancelar
 * son acciones del referente y corren online (mutan estado compartido con feedback).
 */
@Injectable({ providedIn: 'root' })
export class SolicitudMovimientoService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** AY11 — ¿el usuario es un rol referente (ve la bandeja completa + planifica)? */
  async esReferente(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('es_referente_movimiento');
    if (error) return false;
    return (data as boolean) ?? false;
  }

  /** AY11 — badge de solicitudes pendientes (todas para el referente; propias si no). */
  async pendientesCount(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('solicitudes_movimiento_pendientes_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /**
   * AY11 — lista solicitudes. La RLS decide el alcance: el ingeniero ve SOLO las
   * suyas; el referente ve TODAS (por obra y global). Los filtros son opcionales.
   */
  async listar(f: FiltrosSolicitud = {}): Promise<SolicitudMovimiento[]> {
    const { data, error } = await this.supabase.client.rpc('solicitudes_movimiento_listar', {
      p_estado: f.estado ?? null,
      p_proyecto_id: f.proyectoId ?? null,
      p_prioridad: f.prioridad ?? null,
      p_desde: f.desde ?? null,
      p_hasta: f.hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
      id: r['id'] as string,
      solicitante: (r['solicitante'] as string) ?? null,
      proyecto_id: (r['proyecto_id'] as string) ?? null,
      proyecto: (r['proyecto'] as string) ?? null,
      que_se_mueve: (r['que_se_mueve'] as string) ?? '',
      tipo_carga: (r['tipo_carga'] as string) ?? null,
      origen: (r['origen'] as string) ?? null,
      destino: (r['destino'] as string) ?? null,
      prioridad: (r['prioridad'] as PrioridadSolicitud) ?? 'media',
      estado: (r['estado'] as EstadoSolicitud) ?? 'pendiente',
      fecha_solicitud: r['fecha_solicitud'] as string,
      fecha_requerimiento: (r['fecha_requerimiento'] as string) ?? null,
      notas: (r['notas'] as string) ?? null,
      ruta_id: (r['ruta_id'] as string) ?? null,
      conductor: (r['conductor'] as string) ?? null,
      es_prueba: (r['es_prueba'] as boolean) ?? false,
      dias_para_requerimiento: (r['dias_para_requerimiento'] as number) ?? null,
      created_at: r['created_at'] as string,
    }));
  }

  /**
   * AY11 — crea la solicitud OFFLINE por el outbox (idempotencia por UUID de op).
   * El handler la envía a crear_solicitud_movimiento al drenar.
   */
  async crear(input: CrearSolicitudInput): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: OP_CREAR,
      payload: {
        proyecto_id: input.proyectoId,
        que_se_mueve: input.queSeMueve,
        tipo_carga: input.tipoCarga,
        origen_texto: input.origenTexto,
        destino_texto: input.destinoTexto,
        prioridad: input.prioridad,
        fecha_requerimiento: input.fechaRequerimiento,
        notas: input.notas,
      },
    });
  }

  /**
   * AY11 — el referente planifica: crea una ruta pre-llenada y asigna un chofer.
   * La solicitud queda VINCULADA a la ruta y su estado pasa a 'planificada' (el
   * server sincroniza estado ruta→solicitud). Online (feedback inmediato).
   */
  async planificar(
    id: string,
    vehiculoId: string,
    conductorId: string | null,
    fecha: string | null,
    notas: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('planificar_solicitud_con_ruta', {
      p_id: id,
      p_vehiculo_id: vehiculoId,
      p_conductor_id: conductorId,
      p_fecha: fecha,
      p_notas: notas,
    });
    if (error) throw new Error(error.message);
  }

  /** AY11 — marcar completada a mano (solo referentes; el server valida el rol). */
  async completar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('completar_solicitud_movimiento', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** AY11 — cancelar la solicitud (con motivo). */
  async cancelar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cancelar_solicitud_movimiento', {
      p_id: id,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  /** AY11 — registra el handler de outbox de la creación (idempotente por UUID de op). */
  private registerHandler(): void {
    this.sync.register(OP_CREAR, async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_solicitud_movimiento', {
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_que_se_mueve: payload['que_se_mueve'] ?? '',
        p_tipo_carga: payload['tipo_carga'] ?? null,
        p_origen_tipo: 'texto',
        p_origen_texto: payload['origen_texto'] ?? null,
        p_origen_bodega_id: null,
        p_origen_proyecto_id: null,
        p_destino_tipo: 'texto',
        p_destino_texto: payload['destino_texto'] ?? null,
        p_destino_bodega_id: null,
        p_destino_proyecto_id: null,
        p_prioridad: payload['prioridad'] ?? 'media',
        p_fecha_requerimiento: payload['fecha_requerimiento'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throw new Error(error.message);
    });
  }
}
