import { inject, Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { BorradorService } from './borrador.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { db } from '../db/app-db';

/** CK14 — origen de un trabajo (misma enumeración que el contrato SGC). */
export type TrabajoOrigen = 'apoyo' | 'requisicion' | 'manual';

/** CK14 — los 5 eventos que el chofer puede reportar (enum del servidor
 *  `trabajo_evento_chofer`). El orden del flujo es:
 *  en_camino → llegue → trabajando → termine; `problema` es transversal. */
export type TrabajoEvento = 'en_camino' | 'llegue' | 'trabajando' | 'termine' | 'problema';

/** CK14 — estado del ticket (compartido con el ciclo de apoyos). */
export type TrabajoEstado =
  | 'pendiente'
  | 'asignada'
  | 'en_proceso'
  | 'por_confirmar'
  | 'completada'
  | 'cancelada'
  | string;

/** CK14 — una fila de `mis_trabajos_chofer` (aplanada para la UI). */
export interface TrabajoRow {
  origen: TrabajoOrigen;
  origenId: string;
  tipo: string; // tipo_apoyo | 'conduce' | 'actividad'
  descripcion: string;
  proyectoId: string | null;
  proyecto: string | null;
  dia: string | null;
  estado: TrabajoEstado;
  rutaId: string | null;
  vehiculoId: string | null;
  solicitante: string | null;
  solicitanteTelefono: string | null;
  /** Nota de Misael al asignar (hoy solo la trae la actividad manual). */
  nota: string | null;
  /** Rutas de foto (solo apoyos) + su URL firmada best-effort. */
  fotos: Array<{ path: string; url?: string | null }>;
  /** Último evento reportado por ESTE chofer (null = aún no empezó). */
  ultimoEvento: TrabajoEvento | null;
  createdAt: string;
  /** true cuando hay un evento de este trabajo aún en el outbox (sin enviar). */
  pendienteSync?: boolean;
}

/** CK15 — una fila de la bandeja `trabajos_transporte_listado` (vista de Misael). */
export interface BandejaRow {
  origen: TrabajoOrigen;
  origenId: string;
  tipo: string; // tipo_apoyo | 'conduce' | 'actividad'
  descripcion: string;
  proyectoId: string | null;
  proyecto: string | null;
  dia: string | null;
  estado: TrabajoEstado;
  conductorId: string | null;
  conductor: string | null;
  vehiculoId: string | null;
  rutaId: string | null;
  createdAt: string;
}

/** CK15 — filtros server-side de la bandeja (día/chofer); el tab se resuelve en cliente. */
export interface BandejaFiltros {
  dia?: string | null;
  conductorId?: string | null;
}

/** CK15 — input de "asignar" un ticket a un chofer. */
export interface AsignarInput {
  origen: TrabajoOrigen;
  origenId: string;
  conductorId: string;
  vehiculoId?: string | null;
  dia?: string | null;
}

/** CK16 — una tarjeta del panel "Mis choferes" (`mis_choferes_panel`). */
export interface ChoferPanel {
  conductorId: string;
  usuarioId: string | null;
  nombre: string;
  telefono: string | null;
  estado: string;
  estadoDesde: string | null;
  trabajosHoy: number;
  enProceso: number;
  vehiculoEnUso: string | null;
  ultimaSenal: string | null;
  bateria: number | null;
}

/** CK14 — input de "reportar un evento". */
export interface ReportarEventoInput {
  origen: TrabajoOrigen;
  origenId: string;
  evento: TrabajoEvento;
  /** Nota: obligatoria en 'problema', opcional en 'termine'. */
  nota?: string | null;
  /** Foto opcional de "cómo quedó" (solo 'termine'). */
  foto?: Blob | null;
}

const BUCKET = 'apoyo-transporte'; // CK14 — se reutiliza el bucket de Apoyo de transporte
const OP_EVENTO = 'trabajo_evento';
const CAT_MIS = 'mis_trabajos';
const CAT_BANDEJA = 'trabajos_bandeja'; // CK15 — read-through cache de la bandeja de Misael
const CAT_CHOFERES = 'mis_choferes'; // CK16 — read-through cache del panel de choferes

/** Orden del flujo de botones; el índice define el "siguiente" paso válido. */
const FLUJO: TrabajoEvento[] = ['en_camino', 'llegue', 'trabajando', 'termine'];

/**
 * CK14 — "Mis trabajos" del CHOFER + CK15/CK16 (Misael) a futuro.
 *
 * El chofer ve los tickets que Misael le asignó (apoyos + actividades + conduces)
 * y reporta su avance con botones grandes: "Voy en camino" → "Llegué" →
 * "Cargando / trabajando" → "Terminé" (+ foto/nota opcional) y "Tengo un problema"
 * (texto obligatorio). Cada toque viaja por el OUTBOX con la HORA REAL del toque
 * (`p_hora_cliente`), GPS best-effort y un UUID cliente (idempotencia server-side).
 *
 * chofer_estado: lo mueve el SERVIDOR dentro de `trabajo_evento_chofer` (fuente
 * 'auto': en_ruta mientras trabaja, disponible al terminar si no tiene otro), sin
 * pisar descanso/almuerzo/inactivo. La app NO lo toca (evita doble-set).
 *
 * Lectura: `mis_trabajos_chofer` (RPC acotado al chofer; ver sql-para-sgc/). Si el
 * RPC aún no está en el entorno, la lista degrada a vacío sin romper la pantalla.
 */
@Injectable({ providedIn: 'root' })
export class TrabajosService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private borrador = inject(BorradorService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  /** Clave del borrador de la foto de "Terminé" (por op). */
  private claveFoto(opId: string): string {
    return `trabajo:${opId}`;
  }

  /**
   * CK14 — lista los trabajos asignados al chofer (read-through cache, offline-ok).
   * Sobre las filas del servidor se superpone el estado OPTIMISTA de los eventos que
   * aún están en el outbox, para que la tarjeta avance apenas se toca un botón.
   */
  async misTrabajos(dia: string | null = null): Promise<TrabajoRow[]> {
    const key = `${CAT_MIS}:${dia ?? ''}`;
    const data = await this.catalog.refresh<TrabajoRow[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_trabajos_chofer', {
        p_dia: dia ?? null,
      });
      if (error) {
        // Capability fallback: si el RPC del contrato aún no está aplicado en el
        // entorno (PGRST202 / 42883 "function does not exist"), degrada a vacío en
        // lugar de romper la pantalla. El resto de errores sí se propagan.
        if (this.esFuncionAusente(error)) return [];
        throw new Error(error.message);
      }
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => this.mapRow(r));
    });
    const rows = data ?? [];
    // Firma las fotos (best-effort; cae a null offline/sin acceso).
    await Promise.all(
      rows.map(async (row) => {
        await Promise.all(
          row.fotos.map(async (f) => (f.url = await this.signFoto(f.path))),
        );
      }),
    );
    return this.aplicarPendientes(rows);
  }

  private mapRow(r: Record<string, unknown>): TrabajoRow {
    const fotos = ((r['fotos'] as string[]) ?? []).map((path) => ({ path }));
    return {
      origen: (r['origen'] as TrabajoOrigen) ?? 'apoyo',
      origenId: r['origen_id'] as string,
      tipo: (r['tipo'] as string) ?? '',
      descripcion: (r['descripcion'] as string) ?? '',
      proyectoId: (r['proyecto_id'] as string) ?? null,
      proyecto: (r['proyecto'] as string) ?? null,
      dia: (r['dia'] as string) ?? null,
      estado: (r['estado'] as TrabajoEstado) ?? 'asignada',
      rutaId: (r['ruta_id'] as string) ?? null,
      vehiculoId: (r['vehiculo_id'] as string) ?? null,
      solicitante: (r['solicitante'] as string) ?? null,
      solicitanteTelefono: (r['solicitante_telefono'] as string) || null,
      nota: (r['nota'] as string) || null,
      fotos,
      ultimoEvento: (r['ultimo_evento'] as TrabajoEvento) ?? null,
      createdAt: r['created_at'] as string,
    };
  }

  /**
   * CK14 — superpone los eventos ENCOLADOS (sin enviar) sobre las filas del servidor:
   * el último evento pendiente de cada trabajo gana, y el estado se recalcula
   * (termine → por_confirmar; cualquier otro → en_proceso), para que la UI refleje el
   * toque antes de que sincronice.
   */
  private async aplicarPendientes(rows: TrabajoRow[]): Promise<TrabajoRow[]> {
    let pendientes: Array<{ origenId: string; evento: TrabajoEvento; hora: number }> = [];
    try {
      pendientes = (await db.outbox.toArray())
        .filter((o) => o.tipo_op === OP_EVENTO)
        .map((o) => {
          const p = o.payload as Record<string, unknown>;
          const hora = Date.parse((p['hora_cliente'] as string) ?? o.capturado_en ?? '') || 0;
          return { origenId: p['origen_id'] as string, evento: p['evento'] as TrabajoEvento, hora };
        });
    } catch {
      /* best-effort */
    }
    if (!pendientes.length) return rows;
    const ultimoPorTrabajo = new Map<string, TrabajoEvento>();
    for (const p of pendientes.sort((a, b) => a.hora - b.hora)) {
      ultimoPorTrabajo.set(p.origenId, p.evento); // el más reciente queda al final
    }
    return rows.map((row) => {
      const ev = ultimoPorTrabajo.get(row.origenId);
      if (!ev || ev === 'problema') {
        return ev ? { ...row, pendienteSync: true } : row;
      }
      const estado: TrabajoEstado = ev === 'termine' ? 'por_confirmar' : 'en_proceso';
      return { ...row, ultimoEvento: ev, estado, pendienteSync: true };
    });
  }

  /** CK14 — ¿el error del RPC es "la función no existe" (contrato aún sin aplicar)? */
  private esFuncionAusente(error: { code?: string; message?: string }): boolean {
    const code = error.code ?? '';
    const msg = error.message ?? '';
    return code === 'PGRST202' || code === '42883' || /does not exist|could not find|no existe/i.test(msg);
  }

  /** URL firmada de una foto del trabajo (bucket privado). Best-effort. */
  private async signFoto(path: string | null): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** El siguiente evento válido del flujo dado el último reportado (null si terminó). */
  siguienteEvento(ultimo: TrabajoEvento | null): TrabajoEvento | null {
    if (ultimo === 'termine') return null;
    if (!ultimo || ultimo === 'problema') return 'en_camino';
    const i = FLUJO.indexOf(ultimo);
    return i >= 0 && i + 1 < FLUJO.length ? FLUJO[i + 1] : null;
  }

  /**
   * CK14 — reporta un evento del trabajo por el OUTBOX (idempotente por UUID de op).
   * Captura la hora REAL del toque + GPS best-effort (nunca bloquea). La foto de
   * "Terminé" se persiste como borrador (durable, WebKit-safe) y el handler la sube
   * antes de referenciarla. Devuelve el client id de la op.
   */
  async reportarEvento(input: ReportarEventoInput): Promise<string> {
    const id = crypto.randomUUID();
    const horaCliente = new Date().toISOString();
    const { lat, lng } = await this.gpsBestEffort();

    const tieneFoto = !!input.foto;
    if (input.foto) {
      await this.borrador.saveFoto(this.claveFoto(id), 'resultado', input.foto);
    }

    await this.sync.enqueue({
      id,
      tipo_op: OP_EVENTO,
      capturado_en: horaCliente,
      payload: {
        id,
        origen: input.origen,
        origen_id: input.origenId,
        evento: input.evento,
        nota: input.nota?.trim() || null,
        lat,
        lng,
        hora_cliente: horaCliente,
        tiene_foto: tieneFoto,
        capturado_en: horaCliente,
      },
      resumen: {
        tipo: 'trabajo_evento',
        origen_id: input.origenId,
        evento: input.evento,
        capturado_en: horaCliente,
      },
    });
    void this.invalidar();
    return id;
  }

  /** CK14 — GPS de una sola lectura, best-effort: nunca lanza ni bloquea el toque. */
  private async gpsBestEffort(): Promise<{ lat: number | null; lng: number | null }> {
    try {
      const pos = await Promise.race([
        Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 30000 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);
      if (!pos) return { lat: null, lng: null };
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return { lat: null, lng: null };
    }
  }

  async invalidar(): Promise<void> {
    try {
      await this.catalog.invalidatePrefix(CAT_MIS);
    } catch {
      /* best-effort */
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CK15 — "Trabajos de transporte": la bandeja de Misael (gate es_flota_elevado).
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * CK15 — lista unificada de tickets (apoyos + requisiciones sin chofer + actividades
   * manuales) sobre `trabajos_transporte_listado`. Read-through cache (offline-ok): se
   * trae TODO (opcionalmente acotado por día/chofer) y el TAB se resuelve en cliente para
   * que cambiar de pestaña no refetchee. Capability fallback → [] si el RPC aún no está.
   */
  async bandeja(filtros: BandejaFiltros = {}): Promise<BandejaRow[]> {
    const key = `${CAT_BANDEJA}:${filtros.dia ?? ''}:${filtros.conductorId ?? ''}`;
    const data = await this.catalog.refresh<BandejaRow[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('trabajos_transporte_listado', {
        p_dia: filtros.dia ?? null,
        p_estado: null, // el tab (estado) se filtra en cliente
        p_conductor_id: filtros.conductorId ?? null,
      });
      if (error) {
        if (this.esFuncionAusente(error)) return [];
        throw new Error(error.message);
      }
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => this.mapBandeja(r));
    });
    return data ?? [];
  }

  private mapBandeja(r: Record<string, unknown>): BandejaRow {
    return {
      origen: (r['origen'] as TrabajoOrigen) ?? 'apoyo',
      origenId: r['origen_id'] as string,
      tipo: (r['tipo'] as string) ?? '',
      descripcion: (r['descripcion'] as string) ?? '',
      proyectoId: (r['proyecto_id'] as string) ?? null,
      proyecto: (r['proyecto'] as string) ?? null,
      dia: (r['dia'] as string) ?? null,
      estado: (r['estado'] as TrabajoEstado) ?? 'pendiente',
      conductorId: (r['conductor_id'] as string) ?? null,
      conductor: (r['conductor'] as string) ?? null,
      vehiculoId: (r['vehiculo_id'] as string) ?? null,
      rutaId: (r['ruta_id'] as string) ?? null,
      createdAt: r['created_at'] as string,
    };
  }

  /**
   * CK15 — asigna (o reasigna) un ticket a un chofer. ACCIÓN DE ESCRITORIO ONLINE
   * directa (no outbox): crea/añade a la ruta del chofer del día vía el `planificar`
   * de cada fuente y coordina a dos personas — no tiene sentido offline, y Misael la
   * dispara desde un escritorio con señal. REASIGNAR = llamar de nuevo con otro chofer
   * (el servidor lo reconduce). Lanza con el mensaje humano del servidor si falla.
   */
  async asignar(input: AsignarInput): Promise<void> {
    const { error } = await this.supabase.client.rpc('trabajo_asignar', {
      p_origen: input.origen,
      p_origen_id: input.origenId,
      p_conductor_id: input.conductorId,
      p_vehiculo_id: input.vehiculoId ?? null,
      p_dia: input.dia ?? null,
    });
    if (error) throw new Error(error.message);
    await this.invalidarBandeja();
  }

  /**
   * CK15 — "Nueva actividad": ticket manual que Misael inventa (texto + obra/día/chofer
   * opcionales). Online directo (`actividad_crear`). Devuelve el id del ticket creado.
   */
  async nuevaActividad(input: {
    descripcion: string;
    proyectoId?: string | null;
    dia?: string | null;
    conductorId?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('actividad_crear', {
      p_descripcion: input.descripcion,
      p_proyecto_id: input.proyectoId ?? null,
      p_dia: input.dia ?? null,
      p_conductor_id: input.conductorId ?? null,
    });
    if (error) throw new Error(error.message);
    await this.invalidarBandeja();
    return data as string;
  }

  /**
   * CK15 — cancela un ticket con motivo. SOLO apoyo-origen hoy (vía
   * `apoyo_transporte_cambiar_estado('cancelada')`): requisición/manual no tienen una ruta
   * de cancelación en el contrato → la página oculta el botón para esos orígenes. Online.
   */
  async cancelar(input: { origen: TrabajoOrigen; origenId: string; motivo: string }): Promise<void> {
    if (input.origen !== 'apoyo') {
      throw new Error('Solo se pueden cancelar los apoyos de transporte por ahora.');
    }
    const { error } = await this.supabase.client.rpc('apoyo_transporte_cambiar_estado', {
      p_id: input.origenId,
      p_estado: 'cancelada',
      p_nota: input.motivo?.trim() || null,
      p_client_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    await this.invalidarBandeja();
  }

  /** CK15 — ¿se puede cancelar este ticket desde la bandeja? (solo apoyo, no cerrado). */
  puedeCancelar(row: BandejaRow): boolean {
    return row.origen === 'apoyo' && row.estado !== 'completada' && row.estado !== 'cancelada';
  }

  async invalidarBandeja(): Promise<void> {
    try {
      await this.catalog.invalidatePrefix(CAT_BANDEJA);
    } catch {
      /* best-effort */
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CK16 — "Mis choferes": panel de monitoreo (gate es_flota_elevado).
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * CK16 — panel de choferes activos (`mis_choferes_panel`): estado, trabajos de hoy,
   * vehículo en uso, última señal + batería. Read-through cache; capability fallback → [].
   */
  async misChoferes(): Promise<ChoferPanel[]> {
    const data = await this.catalog.refresh<ChoferPanel[]>(CAT_CHOFERES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_choferes_panel');
      if (error) {
        if (this.esFuncionAusente(error)) return [];
        throw new Error(error.message);
      }
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => this.mapChofer(r));
    });
    return data ?? [];
  }

  private mapChofer(r: Record<string, unknown>): ChoferPanel {
    return {
      conductorId: r['conductor_id'] as string,
      usuarioId: (r['usuario_id'] as string) ?? null,
      nombre: (r['nombre'] as string) ?? 'Chofer',
      telefono: (r['telefono'] as string) || null,
      estado: (r['estado'] as string) ?? 'sin_estado',
      estadoDesde: (r['estado_desde'] as string) ?? null,
      trabajosHoy: Number(r['trabajos_hoy'] ?? 0),
      enProceso: Number(r['en_proceso'] ?? 0),
      vehiculoEnUso: (r['vehiculo_en_uso'] as string) || null,
      ultimaSenal: (r['ultima_senal'] as string) ?? null,
      bateria: r['bateria'] == null ? null : Number(r['bateria']),
    };
  }

  /**
   * CK16 — línea de tiempo del día de un chofer: sus eventos de trabajo
   * (`trabajo_eventos`, legibles por flota-elevado vía RLS) desde la medianoche local.
   * Best-effort: si la RLS/tabla no está, devuelve []. No cachea (dato en vivo del tap).
   */
  async eventosChofer(usuarioId: string): Promise<Array<{ evento: TrabajoEvento; nota: string | null; cuando: string }>> {
    if (!usuarioId) return [];
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    try {
      const { data, error } = await this.supabase.client
        .from('trabajo_eventos')
        .select('evento, nota, hora_cliente, created_at')
        .eq('por', usuarioId)
        .gte('created_at', inicioDia.toISOString())
        .order('created_at', { ascending: true });
      if (error) return [];
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        evento: r['evento'] as TrabajoEvento,
        nota: (r['nota'] as string) || null,
        cuando: (r['hora_cliente'] as string) || (r['created_at'] as string),
      }));
    } catch {
      return [];
    }
  }

  async invalidarChoferes(): Promise<void> {
    try {
      await this.catalog.invalidatePrefix(CAT_CHOFERES);
    } catch {
      /* best-effort */
    }
  }

  private registerHandlers(): void {
    // CK14 — al drenar: si el evento trae foto, se sube a apoyo-transporte/<origen_id>/…
    // y luego se referencia por p_foto_path. Idempotente por client_id (server-side).
    this.sync.register(OP_EVENTO, async (payload) => {
      let fotoPath: string | null = null;
      if (payload['tiene_foto']) {
        const clave = this.claveFoto(payload['id'] as string);
        const blobs = await this.borrador.loadFotos(clave);
        const foto = blobs[0];
        if (foto) {
          const type = foto.blob.type || 'image/jpeg';
          fotoPath = `${payload['origen_id']}/trabajo_${payload['id']}.jpg`;
          const { error: upErr } = await this.supabase.client.storage
            .from(BUCKET)
            .upload(fotoPath, foto.blob, { upsert: true, contentType: type });
          if (upErr && !/exists/i.test(upErr.message)) throwSyncError(upErr);
        }
      }

      const { error } = await this.supabase.client.rpc('trabajo_evento_chofer', {
        p_origen: payload['origen'],
        p_origen_id: payload['origen_id'],
        p_evento: payload['evento'],
        p_nota: payload['nota'] ?? null,
        p_lat: payload['lat'] ?? null,
        p_lng: payload['lng'] ?? null,
        p_foto_path: fotoPath,
        p_client_id: payload['id'],
        p_hora_cliente: payload['hora_cliente'] ?? null,
      });
      if (error) throwSyncError(error);

      // Éxito: suelta el borrador de la foto e invalida la lista.
      if (payload['tiene_foto']) {
        await this.borrador.clearFotos(this.claveFoto(payload['id'] as string));
      }
      void this.invalidar();
    });
  }
}
