import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  Cargo,
  FotoTipo,
  PersonalConteos,
  PersonalFirma,
  PersonalFoto,
  PersonalObra,
} from '../models/personal-obra.model';

const BUCKET = 'personal-obra';

/** Todas las fotos de evidencia que maneja el registro (slots del outbox). */
const FOTO_TIPOS: FotoTipo[] = ['persona', 'documento', 'pared', 'carnet', 'persona_carnet_cedula'];

const PERSONAL_SELECT = '*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)';

/** AR1 (app) — datos capturados en el wizard para encolar el registro. */
export interface RegistroCaptura {
  /** Client UUID (idempotencia): también es el id de personal_obra. */
  id: string;
  proyectoId: string;
  nombre: string;
  apellido: string | null;
  nacionalidad: PersonalObra['nacionalidad'];
  tipoDocumento: PersonalObra['tipo_documento'];
  documentoNumero: string | null;
  cargoId: string | null;
  /** AV4 — cuadrilla (eje TECNICO) + aseguramiento manual. */
  cuadrilla: string | null;
  aseguramientoEstado: PersonalObra['aseguramiento_estado'];
  telefono: string | null;
  notas: string | null;
  /** Fotos por tipo (blob). Las ausentes se omiten. */
  fotos: Partial<Record<FotoTipo, Blob>>;
  /** ⏸ Firma del documento (paso PAUSA): PNG del pad + nombre del documento. */
  firma?: Blob | null;
  firmaDocumentoNombre?: string | null;
}

/**
 * AR1 — Registro de Personal de obra (app). Registro EN OBRA por hojas
 * (offline-first): el wizard encola UNA op de outbox con las 5 fotos + datos;
 * el handler inserta el personal (client UUID = idempotencia), sube las fotos,
 * registra la firma (si viene) y **emite el carnet** (número CSD-###### server).
 * Lecturas cache-then-network (la RLS acota por obra: elevados todo, ingeniero/
 * capataz su obra). Reúsa el mismo contrato/entidad que SGC (carnet/QR/expediente).
 */
@Injectable({ providedIn: 'root' })
export class PersonalObraService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  private get client() {
    return this.supabase.client;
  }

  constructor() {
    this.registerHandlers();
  }

  // ── Catálogo de cargos (referencia, cache — funciona offline) ───────────────
  async getCargos(): Promise<Cargo[]> {
    const data = await this.catalog.refresh<Cargo[]>('personal_cargos', async () => {
      const { data, error } = await this.client.from('cargos').select('*').eq('activo', true).order('orden');
      if (error) throw new Error(error.message);
      return (data ?? []) as Cargo[];
    });
    return data ?? [];
  }

  // ── Obras visibles (directorio SECURITY DEFINER, desacoplado del módulo AN3) ─
  async getObras(): Promise<{ id: string; nombre: string }[]> {
    const data = await this.catalog.refresh<{ id: string; nombre: string }[]>('personal_obras', async () => {
      const { data, error } = await this.client.rpc('directorio_proyectos');
      if (error) throw new Error(error.message);
      return ((data as { id: string; nombre: string }[]) ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));
    });
    return data ?? [];
  }

  // ── Listado del personal (RLS por obra) — cache-then-network ────────────────
  async listar(): Promise<PersonalObra[]> {
    const data = await this.catalog.refresh<PersonalObra[]>('personal_lista', async () => {
      const { data, error } = await this.client
        .from('personal_obra')
        .select(PERSONAL_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PersonalObra[];
    });
    return data ?? [];
  }

  async getById(id: string): Promise<PersonalObra | null> {
    const { data, error } = await this.client.from('personal_obra').select(PERSONAL_SELECT).eq('id', id).maybeSingle();
    if (error || !data) {
      const cached = (await this.catalog.read<PersonalObra[]>('personal_lista')) ?? [];
      return cached.find((p) => p.id === id) ?? null;
    }
    return data as unknown as PersonalObra;
  }

  async getFotos(personalId: string): Promise<PersonalFoto[]> {
    const { data, error } = await this.client.from('personal_obra_fotos').select('*').eq('personal_id', personalId);
    if (error) return [];
    return (data ?? []) as PersonalFoto[];
  }

  async getFirmas(personalId: string): Promise<PersonalFirma[]> {
    const { data, error } = await this.client
      .from('personal_obra_firmas')
      .select('*')
      .eq('personal_id', personalId)
      .order('firmado_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as PersonalFirma[];
  }

  /** Conteos por obra (total, por cargo, por nacionalidad) — espejo de la web. */
  async conteos(proyectoId: string): Promise<PersonalConteos | null> {
    const { data, error } = await this.client.rpc('personal_obra_conteos', { p_proyecto_id: proyectoId });
    if (error) return null;
    if (!data || Object.keys(data).length === 0) return null;
    return data as PersonalConteos;
  }

  /** URL firmada de una foto del bucket privado (thumbnail opcional). */
  async fotoUrl(path: string, thumb = false): Promise<string | null> {
    const { data } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600, thumb ? { transform: { width: 400, quality: 70 } } : undefined);
    return data?.signedUrl ?? null;
  }

  // ── Registro (offline-first, por outbox) ────────────────────────────────────
  /** Encola el registro completo (datos + fotos + firma) como UNA op idempotente. */
  async enqueueRegistro(input: RegistroCaptura): Promise<void> {
    const id = input.id;
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    for (const tipo of FOTO_TIPOS) {
      const blob = input.fotos[tipo];
      if (blob) {
        fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${input.proyectoId}/${id}/${tipo}.jpg`, slot: tipo, blob });
      }
    }
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${input.proyectoId}/${id}/firma.png`, slot: 'firma', blob: input.firma });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'personal_registro',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        nombre: input.nombre,
        apellido: input.apellido,
        nacionalidad: input.nacionalidad,
        tipo_documento: input.tipoDocumento,
        documento_numero: input.documentoNumero,
        cargo_id: input.cargoId,
        cuadrilla: input.cuadrilla, // AV4
        aseguramiento_estado: input.aseguramientoEstado ?? 'desconocido', // AV4
        telefono: input.telefono,
        notas: input.notas,
        registrado_por: this.ctx.profile()?.id ?? null,
        firma_documento_nombre: input.firmaDocumentoNombre ?? null,
      },
      fotos,
      resumen: { tipo: 'personal_registro', nombre: `${input.nombre} ${input.apellido ?? ''}`.trim(), capturado_en },
    });
    // No se invalida el cache aquí: offline dejaría la lista vacía (no hay red para
    // recargarla). El handler invalida `personal_lista` tras sincronizar con éxito.
  }

  /** Edita datos (offline-safe). `cambios` = columnas a actualizar. */
  async enqueueEditar(id: string, cambios: Partial<PersonalObra>): Promise<void> {
    const opId = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: opId,
      tipo_op: 'personal_editar',
      capturado_en,
      payload: { id, cambios: cambios as Record<string, unknown> },
      fotos: [],
      resumen: { tipo: 'personal_editar', personal_id: id, capturado_en },
    });
    // El handler invalida `personal_lista` al sincronizar (no aquí: offline dejaría
    // la lista en blanco). El expediente ya refleja el cambio de forma optimista.
  }

  /** Activa/desactiva al personal (soft, por outbox). */
  async enqueueEstado(id: string, estado: PersonalObra['estado']): Promise<void> {
    await this.enqueueEditar(id, { estado });
  }

  private registerHandlers(): void {
    // Registro completo: personal + fotos + firma (⏸) + carnet.
    this.sync.register('personal_registro', async (payload, photoPaths) => {
      const id = payload['id'] as string;
      // 1) Personal (upsert por id → idempotente ante reintentos). La RLS valida
      //    el permiso (puede_gestionar_personal_obra) y el trigger fija es_prueba.
      const { error: upErr } = await this.client.from('personal_obra').upsert(
        {
          id,
          proyecto_id: payload['proyecto_id'],
          nombre: payload['nombre'],
          apellido: payload['apellido'] ?? null,
          nacionalidad: payload['nacionalidad'] ?? 'dominicano',
          tipo_documento: payload['tipo_documento'] ?? 'cedula',
          documento_numero: payload['documento_numero'] ?? null,
          cargo_id: payload['cargo_id'] ?? null,
          cuadrilla: payload['cuadrilla'] ?? null, // AV4
          aseguramiento_estado: payload['aseguramiento_estado'] ?? 'desconocido', // AV4
          telefono: payload['telefono'] ?? null,
          notas: payload['notas'] ?? null,
          registrado_por: payload['registrado_por'] ?? null,
        },
        { onConflict: 'id' },
      );
      if (upErr) throwSyncError(upErr);

      // 2) Fotos tipadas (upsert una por tipo → idempotente).
      const fotoRows = FOTO_TIPOS.filter((t) => photoPaths[t]).map((t) => ({
        personal_id: id,
        tipo: t,
        foto_path: photoPaths[t],
      }));
      if (fotoRows.length) {
        const { error } = await this.client.from('personal_obra_fotos').upsert(fotoRows, { onConflict: 'personal_id,tipo' });
        if (error) throwSyncError(error);
      }

      // 3) ⏸ Firma del documento (paso en PAUSA): solo si el wizard la produjo. Se
      //    inserta una sola vez (evita duplicar al reintentar la op).
      if (photoPaths['firma']) {
        const { count } = await this.client
          .from('personal_obra_firmas')
          .select('id', { count: 'exact', head: true })
          .eq('personal_id', id);
        if (!count) {
          const { error } = await this.client.from('personal_obra_firmas').insert({
            personal_id: id,
            documento_nombre: (payload['firma_documento_nombre'] as string) ?? 'Documento firmado',
            firma_path: photoPaths['firma'],
            metodo: 'pad',
          });
          if (error) throwSyncError(error);
        }
      }

      // 4) Emite el carnet (número CSD-###### server-side; idempotente).
      const { error: cErr } = await this.client.rpc('emitir_carnet_personal', { p_id: id });
      if (cErr) throwSyncError(cErr);

      this.catalog.invalidate('personal_lista');
    });

    // Edición de datos / cambio de estado.
    this.sync.register('personal_editar', async (payload) => {
      const cambios = (payload['cambios'] as Record<string, unknown>) ?? {};
      const { error } = await this.client.from('personal_obra').update(cambios).eq('id', payload['id']);
      if (error) throwSyncError(error);
      this.catalog.invalidate('personal_lista');
    });
  }
}
