import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, PermanentSyncError, SyncService } from '../sync/sync.service';
import { AyudanteService } from './ayudante.service';
import {
  CombustibleCaptura,
  EchadaDetalle,
  EchadaLog,
  NeedsConfirmResp,
  PrecioCombustibleVigente,
  REND_MAX_KM_GAL,
  REND_MIN_KM_GAL,
  TanqueConfig,
  TANQUE_CONFIG_DEFAULT,
  UltimaEchada,
} from '../models/combustible.model';
import { db } from '../db/app-db';

const CATALOG_ULTIMA = 'combustible_ultima'; // + `:${vehiculoId}`

/**
 * Fuel-log data + write path. The previous fill-up (for live km/rendimiento
 * validation) is read through the catalog cache (offline-friendly); the write
 * is enqueued in the outbox and committed by the registered handler
 * (registrar_combustible_app) when there's connectivity. Mirrors
 * MantenimientosService / VehiculosService.
 */
@Injectable({ providedIn: 'root' })
export class CombustibleService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);
  private ayudantes = inject(AyudanteService); // AT4

  constructor() {
    this.registerHandler();
  }

  /**
   * The vehicle's previous fill-up + average km/gal, for live validation and
   * the abnormal-consumption preview. Cached per vehicle so it works offline.
   */
  async getUltimaEchada(vehiculoId: string): Promise<UltimaEchada> {
    const key = `${CATALOG_ULTIMA}:${vehiculoId}`;
    const data = await this.catalog.refresh<UltimaEchada>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('registros_combustible')
        .select('kilometraje, fecha, rendimiento_km_gal, estado')
        .eq('vehiculo_id', vehiculoId)
        .not('kilometraje', 'is', null)
        .order('kilometraje', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        kilometraje: number | null;
        fecha: string | null;
        rendimiento_km_gal: number | null;
        estado: string | null;
      }>;
      // AW2 — el promedio "esperado" solo usa echadas VÁLIDAS: excluye las
      // marcadas anómalas y los outliers de piso/techo (rendimiento imposible),
      // para que el número que muestra la app cuadre con el del servidor.
      const rends = rows
        .filter((r) => r.estado !== 'anormal')
        .map((r) => r.rendimiento_km_gal)
        .filter((x): x is number => x != null && x >= REND_MIN_KM_GAL && x <= REND_MAX_KM_GAL);
      const promedio = rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
      // AE7 — la FECHA de referencia debe ser la del registro MÁS RECIENTE, no la
      // del de mayor kilometraje (ordenamos por km para la base del odómetro, pero
      // esa fila no es necesariamente la última cronológicamente).
      const fechas = rows.map((r) => r.fecha).filter((x): x is string => !!x).sort();
      return {
        km: rows.length ? rows[0].kilometraje : null,
        fecha: fechas.length ? fechas[fechas.length - 1] : null,
        promedio_rendimiento: promedio,
        n_echadas: rends.length,
      };
    });
    const base = data ?? { km: null, fecha: null, promedio_rendimiento: null, n_echadas: 0 };

    // Considera echadas ya capturadas pero aún en la cola offline (sin sincronizar):
    // sin esto, una 2ª echada offline usa el km del servidor como base y la RPC la
    // rechaza al sincronizar (km <= km_anterior) dejándola en error permanente.
    const pendKm = await this.maxKmPendiente(vehiculoId);
    if (pendKm != null && (base.km == null || pendKm > base.km)) {
      return { ...base, km: pendKm };
    }
    return base;
  }

  /**
   * AF17 — "Registro de echadas" para roles elevados (admin/jefe de flota/…). El
   * RPC `log_combustible` ya gatea por rol (devuelve [] a no autorizados) y aísla
   * los vehículos de prueba (solo admin). Online-first con cache razonable.
   */
  async getLogEchadas(filtros: {
    desde?: string | null;
    hasta?: string | null;
    vehiculoId?: string | null;
    usuarioId?: string | null;
  } = {}): Promise<EchadaLog[]> {
    const { data, error } = await this.supabase.client.rpc('log_combustible', {
      p_desde: filtros.desde ?? null,
      p_hasta: filtros.hasta ?? null,
      p_vehiculo_id: filtros.vehiculoId ?? null,
      p_usuario_id: filtros.usuarioId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data as EchadaLog[]) ?? [];
  }

  /**
   * AQ13/AQ6 — detalle de UNA echada por id. Lee registros_combustible directo
   * (RLS: elevado ve todas; el chofer ve las de sus vehículos). Enriquece placa +
   * nombres (usuarios via RPC) y firma las fotos (bucket vehiculos) para el lightbox.
   * Devuelve null si no existe o el usuario no tiene acceso (RLS).
   */
  async getEchadaDetalle(id: string): Promise<EchadaDetalle | null> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select(
        'id, fecha, created_at, vehiculo_id, conductor_id, registrado_por, kilometraje, km_anterior, km_recorridos, galones, monto, precio_por_galon, rendimiento_km_gal, costo_por_km, producto, subtipo, estacion, estado, alerta_consumo, km_alerta, motivo_alerta, origen, foto_recibo_path, foto_tablero_path, foto_bomba_path',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as Record<string, unknown>;

    // Nombres (usuarios es admin-only RLS → resolver por RPC seguro).
    const ids = [row['conductor_id'], row['registrado_por']].filter(Boolean) as string[];
    const nombres: Record<string, string> = {};
    if (ids.length) {
      try {
        const { data: us } = await this.supabase.client.rpc('usuarios_por_ids', { p_ids: ids });
        for (const u of (us as Array<{ id: string; nombre: string }>) ?? []) nombres[u.id] = u.nombre;
      } catch {
        /* best-effort: sin nombres, el detalle sigue */
      }
    }

    // Placa/descripción del vehículo (best-effort).
    let placa: string | null = null;
    let vehiculoDesc: string | null = null;
    if (row['vehiculo_id']) {
      try {
        const { data: v } = await this.supabase.client
          .from('vehiculos')
          .select('placa, marca, modelo')
          .eq('id', row['vehiculo_id'] as string)
          .maybeSingle();
        if (v) {
          const vv = v as { placa?: string; marca?: string; modelo?: string };
          placa = vv.placa ?? null;
          vehiculoDesc = [vv.marca, vv.modelo].filter(Boolean).join(' ') || null;
        }
      } catch {
        /* best-effort */
      }
    }

    const conductorId = (row['conductor_id'] as string | null) ?? null;
    const registradoPor = (row['registrado_por'] as string | null) ?? null;
    return {
      id: row['id'] as string,
      fecha: row['fecha'] as string,
      created_at: row['created_at'] as string,
      vehiculo_id: (row['vehiculo_id'] as string | null) ?? null,
      placa,
      vehiculo_desc: vehiculoDesc,
      conductor_id: conductorId,
      conductor_nombre: conductorId ? nombres[conductorId] ?? null : null,
      registrado_por: registradoPor,
      registrado_nombre: registradoPor ? nombres[registradoPor] ?? null : null,
      kilometraje: (row['kilometraje'] as number | null) ?? null,
      km_anterior: (row['km_anterior'] as number | null) ?? null,
      km_recorridos: (row['km_recorridos'] as number | null) ?? null,
      galones: (row['galones'] as number | null) ?? null,
      monto: (row['monto'] as number | null) ?? null,
      precio_por_galon: (row['precio_por_galon'] as number | null) ?? null,
      rendimiento_km_gal: (row['rendimiento_km_gal'] as number | null) ?? null,
      costo_por_km: (row['costo_por_km'] as number | null) ?? null,
      producto: (row['producto'] as string | null) ?? null,
      subtipo: (row['subtipo'] as string | null) ?? null,
      estacion: (row['estacion'] as string | null) ?? null,
      estado: (row['estado'] as string | null) ?? null,
      alerta_consumo: (row['alerta_consumo'] as boolean | null) ?? null,
      km_alerta: (row['km_alerta'] as boolean | null) ?? null,
      motivo_alerta: (row['motivo_alerta'] as string | null) ?? null,
      origen: (row['origen'] as string | null) ?? null,
      foto_recibo_url: await this.signVehiculoFoto(row['foto_recibo_path'] as string | null),
      foto_tablero_url: await this.signVehiculoFoto(row['foto_tablero_path'] as string | null),
      foto_bomba_url: await this.signVehiculoFoto(row['foto_bomba_path'] as string | null),
    };
  }

  /** URL firmada de una foto de echada (bucket vehiculos, privado). Best-effort. */
  private async signVehiculoFoto(path: string | null): Promise<string | null> {
    if (!path) return null;
    try {
      const { data } = await this.supabase.client.storage.from('vehiculos').createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Mayor kilometraje de echadas de este vehículo aún pendientes en el outbox. */
  private async maxKmPendiente(vehiculoId: string): Promise<number | null> {
    try {
      const ops = await db.outbox.where('tipo_op').equals('combustible').toArray();
      let max: number | null = null;
      for (const op of ops) {
        const p = op.payload as { vehiculo_id?: string; kilometraje?: number };
        if (p?.vehiculo_id === vehiculoId && typeof p.kilometraje === 'number') {
          if (max == null || p.kilometraje > max) max = p.kilometraje;
        }
      }
      return max;
    } catch {
      return null;
    }
  }

  /**
   * T4 — catálogo de estaciones (sgc.estaciones_combustible), cacheado offline.
   * Total Energies viene primero (orden). "Otro" queda fuera de la lista (la UI
   * ofrece su propia opción de texto libre). El payload sigue enviando texto.
   */
  async getEstaciones(): Promise<string[]> {
    const data = await this.catalog.refresh<string[]>('estaciones_combustible', async () => {
      const { data, error } = await this.supabase.client
        .from('estaciones_combustible')
        .select('nombre, orden')
        .eq('activo', true)
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as { nombre: string }[]) ?? []).map((r) => r.nombre);
    });
    return data ?? [];
  }

  /**
   * AA20 — precios oficiales vigentes (MICM) por producto canónico. Se usan como
   * referencia al registrar la echada. Cacheados offline (último conocido) por el
   * canal de catálogos; devuelve [] sin señal en frío.
   */
  async getPreciosVigentes(): Promise<PrecioCombustibleVigente[]> {
    const data = await this.catalog.refresh<PrecioCombustibleVigente[]>('fuel_prices_vigentes', async () => {
      const { data, error } = await this.supabase.client.rpc('precios_combustible_vigentes');
      if (error) throw new Error(error.message);
      return (data as PrecioCombustibleVigente[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AW3 — umbrales de tanque/precio (sgc.flota_config) para el preview del
   * cliente. Cacheados offline (último conocido). El servidor revalida.
   */
  async getTanqueConfig(): Promise<TanqueConfig> {
    const data = await this.catalog.refresh<TanqueConfig>('tanque_config', async () => {
      const { data, error } = await this.supabase.client.from('flota_config').select('clave, valor');
      if (error) throw new Error(error.message);
      const m = new Map((data ?? []).map((r: { clave: string; valor: string }) => [r.clave, Number(r.valor)]));
      const val = (k: string, d: number) => {
        const n = m.get(k);
        return n != null && !Number.isNaN(n) ? n : d;
      };
      const d = TANQUE_CONFIG_DEFAULT;
      return {
        capPorClase: {
          automovil: val('tanque_cap_automovil', d.capPorClase['automovil']),
          suv: val('tanque_cap_suv', d.capPorClase['suv']),
          pickup: val('tanque_cap_pickup', d.capPorClase['pickup']),
          camion: val('tanque_cap_camion', d.capPorClase['camion']),
          pesado: val('tanque_cap_pesado', d.capPorClase['pesado']),
        },
        capDefault: val('tanque_cap_default', d.capDefault),
        margenBloqueo: val('tanque_margen_bloqueo', d.margenBloqueo),
        margenAlerta: val('tanque_margen_alerta', d.margenAlerta),
        precioMin: val('precio_gal_min', d.precioMin),
        precioMax: val('precio_gal_max', d.precioMax),
      };
    });
    return data ?? TANQUE_CONFIG_DEFAULT;
  }

  /**
   * AW3 — capacidad de tanque + clase (`tipo`) del vehículo, para el preview del
   * bloqueo por galones. Cacheado por vehículo (offline-friendly).
   */
  async getCapacidadTanque(vehiculoId: string): Promise<{ capacidad: number | null; tipo: string | null }> {
    const data = await this.catalog.refresh<{ capacidad: number | null; tipo: string | null }>(
      `tanque_veh:${vehiculoId}`,
      async () => {
        const { data, error } = await this.supabase.client
          .from('vehiculos')
          .select('capacidad_tanque_gal, tipo')
          .eq('id', vehiculoId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const r = (data ?? {}) as { capacidad_tanque_gal?: number | null; tipo?: string | null };
        return { capacidad: r.capacidad_tanque_gal ?? null, tipo: r.tipo ?? null };
      },
    );
    return data ?? { capacidad: null, tipo: null };
  }

  /**
   * AW2 — cancela una echada AÚN pendiente en el outbox (para "Revisar y corregir").
   * Borra la op + sus fotos + el registro local, atómicamente. Devuelve false si ya
   * se envió (no hay nada que cancelar) — en ese caso no se puede corregir en sitio.
   */
  async cancelarPendiente(id: string): Promise<boolean> {
    return this.sync.cancelPending(id);
  }

  /** Queue a fuel record. Works fully offline; syncs when there's signal. Returns the client id. */
  async registrar(input: CombustibleCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    // AC11 — depósito en obra: solo una foto de evidencia (garrafón/equipo). Se
    // guarda en el slot `recibo` para que el detalle web la muestre como evidencia.
    // Estación: las 3 fotos de siempre (recibo + tablero + bomba en 0).
    const fotos: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }> = [];
    const addFoto = (slot: string, name: string, blob: Blob | null) => {
      if (blob) fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `combustible/${id}/${name}`, slot, blob });
    };
    if (input.origen === 'deposito_obra') {
      addFoto('recibo', 'evidencia.jpg', input.fotoEvidencia);
    } else {
      addFoto('recibo', 'recibo.jpg', input.fotoRecibo);
      addFoto('tablero', 'tablero.jpg', input.fotoTablero); // Z23-app — sin tablero en echada de persona
      addFoto('bomba', 'bomba.jpg', input.fotoBomba); // Y4 — bomba/estación en 0
    }

    await this.sync.enqueue({
      id,
      tipo_op: 'combustible',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId, // Z23-app — null en echada de persona
        conductor_id: input.conductorId,
        fecha: input.fecha,
        // Z23-app — sin odómetro en echada de persona.
        kilometraje: input.kilometraje != null ? Math.round(input.kilometraje) : null,
        galones: input.galones,
        monto: input.monto,
        estacion: input.estacion,
        origen: input.origen, // AC11
        proyecto_id: input.proyectoId, // AC11
        producto: input.producto, // Z23-app
        subtipo: input.subtipo, // AA20
        tarjeta: input.tarjeta, // Z23-app
        titular: input.titular, // Z23-app
        titular_es_persona: input.titularEsPersona, // Z23-app
        ayudante_id: input.ayudanteId ?? null, // AT4
        confirmado: input.confirmado ?? false, // AW3 — echada inusual ya confirmada
      },
      fotos,
      resumen: {
        placa: input.placa,
        galones: input.galones,
        monto: input.monto,
        capturado_en,
      },
    });

    // The "última echada" cache changes after a fill-up; refresh best-effort.
    // (No aplica a una echada de persona: no está atada a un vehículo.)
    if (input.vehiculoId) void this.getUltimaEchada(input.vehiculoId);
    return id;
  }

  private registerHandler(): void {
    this.sync.register('combustible', async (payload, photoPaths) => {
      const { data, error } = await this.supabase.client.rpc('registrar_combustible_app', {
        p_client_uuid: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: payload['conductor_id'] ?? null,
        p_fecha: payload['fecha'],
        p_kilometraje: payload['kilometraje'],
        p_galones: payload['galones'],
        p_monto: payload['monto'],
        p_estacion: payload['estacion'] ?? null,
        p_foto_recibo_path: photoPaths['recibo'] ?? null,
        p_foto_tablero_path: photoPaths['tablero'] ?? null,
        p_foto_bomba_path: photoPaths['bomba'] ?? null, // Y4
        p_notas: null,
        p_producto: payload['producto'] ?? null, // Z23-app
        p_subtipo: payload['subtipo'] ?? null, // AA20
        p_tarjeta: payload['tarjeta'] ?? null, // Z23-app
        p_titular: payload['titular'] ?? null, // Z23-app
        p_titular_es_persona: payload['titular_es_persona'] ?? false, // Z23-app
        p_origen: payload['origen'] ?? 'estacion', // AC11
        p_proyecto_id: payload['proyecto_id'] ?? null, // AC11
        p_confirmado: payload['confirmado'] === true, // AW3 — echada inusual ya confirmada por el chofer
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);

      // AW3 — confirmación suave: la RPC NO insertó y devolvió needs_confirm. En el
      // flujo normal esto se resuelve en pantalla ANTES de encolar (se envía
      // p_confirmado=true), así que llegar aquí significa un desfase de umbrales
      // (p. ej. la capacidad del vehículo cambió). NO marcar ✅ ni reintentar en
      // bucle: se detiene visible (estado 'error') con el mensaje del server para
      // que el chofer la vuelva a registrar y confirme. Nada se pierde en silencio.
      const nc = data as NeedsConfirmResp | null;
      if (nc && nc.needs_confirm === true) {
        throw new PermanentSyncError(
          nc.confirm_message ??
            'Esta echada es inusualmente grande y necesita que la confirmes. Vuelve a registrarla y confirma la cantidad.',
          'validacion',
        );
      }

      // AT4 — sumarle la echada al ayudante. registrar_combustible_app NO devuelve
      // el row id, así que lo resolvemos por client_uuid (echada_id) y marcamos.
      const ayudanteId = payload['ayudante_id'] as string | null | undefined;
      if (ayudanteId) {
        try {
          const { data: echId } = await this.supabase.client.rpc('echada_id', { p_client_uuid: payload['id'] });
          if (echId) await this.ayudantes.marcar('echada', echId as string, ayudanteId);
        } catch {
          /* best-effort: la echada ya quedó registrada */
        }
      }

      // P7 — el RPC avanza vehiculos.kilometraje; invalidar caches con km.
      // Z23-app — una echada de persona no toca ningún vehículo: nada que invalidar.
      const vehId = payload['vehiculo_id'] as string | null;
      if (vehId) {
        await this.catalog.invalidate(`veh_detalle:${vehId}`);
        await this.catalog.invalidate('pendientes_transporte');
        await this.catalog.invalidate('flota_vehiculos');
        await this.catalog.invalidate('mis_asignaciones'); // AF21
      }
    });
  }
}
