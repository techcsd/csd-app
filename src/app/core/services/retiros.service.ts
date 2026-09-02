import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Proyecto } from '../models/bitacora.model';
import { RetiroCaptura, RetiroDetalle, RetiroListado } from '../models/retiro.model';

const BUCKET = 'sgc-retiro';
const CAT_MIS_RETIROS = 'mis_retiros';

/**
 * BG4 — Retiro de material DAÑADO. La solicitud NACE en el teléfono del ingeniero
 * con fotos OBLIGATORIAS del material (la evidencia es el corazón del control).
 * Offline-first: entra al outbox como todo lo demás, con las 3 categorías de BG1.
 * Aprobación / conduce de retiro / recepción / disposición viven en management
 * (web o app de almacén). Server ya construido (contrato BG4-retiro-material).
 */
@Injectable({ providedIn: 'root' })
export class RetirosService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Obras del ingeniero (scoped, espejo de la requisición: proyectos_pickables). */
  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>('proyectos', async () => {
      const { data, error } = await this.supabase.client.rpc('proyectos_pickables');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** BG4 — "Mis retiros" (o todos los visibles por rol). Cache-then-network. */
  async misRetiros(soloMios = true): Promise<RetiroListado[]> {
    const data = await this.catalog.refresh<RetiroListado[]>(CAT_MIS_RETIROS, async () => {
      const { data, error } = await this.supabase.client.rpc('retiros_listado', {
        p_estado: null,
        p_solo_mios: soloMios,
        p_limite: 200,
      });
      if (error) throw new Error(error.message);
      return (data as RetiroListado[]) ?? [];
    });
    return data ?? [];
  }

  /** BG4 — detalle de un retiro (cache-then-network para verlo offline). */
  async detalle(id: string): Promise<RetiroDetalle | null> {
    const data = await this.catalog.refresh<RetiroDetalle | null>(`retiro_detalle:${id}`, async () => {
      const { data, error } = await this.supabase.client.rpc('retiro_detalle', { p_id: id });
      if (error) throw new Error(error.message);
      return (data as RetiroDetalle) ?? null;
    });
    return data ?? null;
  }

  async invalidarCache(id?: string): Promise<void> {
    await this.catalog.invalidate(CAT_MIS_RETIROS);
    if (id) await this.catalog.invalidate(`retiro_detalle:${id}`);
  }

  /** BG4 — URL firmada de una foto del retiro (bucket privado sgc-retiro). */
  async fotoUrl(path: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) return null;
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** BG4 — cancela un retiro con motivo obligatorio (solicitante o gestor). Online. */
  async cancelar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('retiro_cancelar', { p_id: id, p_motivo: motivo });
    if (error) throw new Error(error.message);
    await this.invalidarCache(id);
  }

  /**
   * BG4 — encola la solicitud de retiro (offline-first). Las fotos suben al bucket
   * sgc-retiro y el handler llama crear_retiro_material. La foto es OBLIGATORIA
   * server-side (rechaza con error_campo si falta → categoría 'dato' del outbox).
   */
  async enqueueRetiro(input: RetiroCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.fotos.map((blob, i) => ({
      id: `${id}:foto_${i}`,
      bucket: BUCKET,
      path: `${id}/dano/${i}.jpg`,
      slot: `foto_${i}`,
      blob,
    }));
    await this.sync.enqueue({
      id,
      tipo_op: 'retiro_material',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        motivo_dano: input.motivoDano,
        motivo_dano_detalle: input.motivoDanoDetalle,
        notas: input.notas,
        items: input.items,
        es_prueba: input.esPrueba,
        // Slots de las fotos → el handler las resuelve a p_fotos[{path}].
        foto_slots: fotos.map((f) => f.slot),
      },
      fotos,
      resumen: { tipo: 'retiro_material', capturado_en, items: input.items.length },
    });
    void this.misRetiros();
    return id;
  }

  private registerHandler(): void {
    this.sync.register('retiro_material', async (payload, photoPaths) => {
      // Resolver los slots de foto a las rutas subidas (p_fotos[{path}]).
      const slots = (payload['foto_slots'] as string[] | undefined) ?? Object.keys(photoPaths);
      const p_fotos = slots
        .map((slot) => photoPaths[slot])
        .filter((path): path is string => !!path)
        .map((path) => ({ path, nombre: path.split('/').pop() ?? 'foto.jpg' }));

      const detalle = payload['motivo_dano'] === 'otro' ? (payload['motivo_dano_detalle'] ?? null) : null;
      const { error } = await this.supabase.client.rpc('crear_retiro_material', {
        p_proyecto_id: payload['proyecto_id'],
        p_almacen_destino_id: null, // lo asigna el aprobador
        p_motivo_dano: payload['motivo_dano'],
        p_motivo_dano_detalle: detalle,
        p_notas: payload['notas'] ?? null,
        p_items: payload['items'],
        p_fotos,
        p_es_prueba: payload['es_prueba'] ?? false,
        // BG4 follow-up — idempotencia: un reenvío con el mismo id no duplica.
        p_client_id: payload['id'],
      });
      if (error) throwSyncError(error);
    });
  }
}
