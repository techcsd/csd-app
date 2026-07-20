import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { PermanentSyncError, SyncService } from '../sync/sync.service';
import { ClCaptura, ClPlantilla, ClProyecto } from '../models/cl-liberacion.model';

const CATALOG_PLANTILLAS = 'cl_plantillas';
const CATALOG_PROYECTOS = 'proyectos';
const BUCKET = 'obra';

/**
 * CSD-OPE-01 §6.8/§9 — Checklists de Liberación (CL-01..07), captura de campo.
 * Las plantillas/proyectos se leen del catálogo (offline). El CL se encola en el
 * outbox y lo confirma registrar_cl_app (idempotente por p_id) al haber señal.
 * Media (plano, fotos, firmas) sube al bucket privado `obra`. Mirrors
 * ChecklistPreusoService.
 */
@Injectable({ providedIn: 'root' })
export class ClLiberacionService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** CL templates + items, cached for offline use. */
  async getPlantillas(): Promise<ClPlantilla[]> {
    const data = await this.catalog.refresh<ClPlantilla[]>(CATALOG_PLANTILLAS, async () => {
      const { data, error } = await this.supabase.client
        .from('cl_plantillas')
        .select('id, codigo, nombre, fase, orden, items:cl_plantilla_items(*)')
        .eq('activo', true)
        .order('orden', { ascending: true })
        .order('codigo', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as ClPlantilla[]) ?? []).map((p) => ({
        ...p,
        items: [...(p.items ?? [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)),
      }));
    });
    return data ?? [];
  }

  async getProyectos(): Promise<ClProyecto[]> {
    const data = await this.catalog.refresh<ClProyecto[]>(CATALOG_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre')
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as ClProyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** Queue a liberación checklist. Works fully offline; syncs when there's signal.
   *  Q5 — devuelve el id (client uuid) para poder "solicitar firma" del CL. */
  async enqueueCl(input: ClCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }> = [];

    if (input.plano) {
      fotos.push({
        id: crypto.randomUUID(),
        bucket: BUCKET,
        path: `cl/${id}/plano.jpg`,
        slot: 'plano',
        blob: input.plano,
      });
    }

    const fotosMeta = input.fotos.map((f, idx) => {
      const slot = `foto_${idx}`;
      fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `cl/${id}/${slot}.jpg`, slot, blob: f.blob });
      return { slot, correcto: f.correcto, descripcion: f.descripcion };
    });

    const firmasMeta = input.firmas.map((s, idx) => {
      const metodo = s.metodo ?? 'pad';
      const ext = metodo === 'foto' ? 'jpg' : 'png';
      const slot = `firma_${idx}`;
      fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `cl/${id}/${slot}.${ext}`, slot, blob: s.blob });
      return { slot, rol: s.rol, nombre: s.nombre, orden: idx, metodo };
    });

    await this.sync.enqueue({
      id,
      tipo_op: 'cl_liberacion',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        plantilla_id: input.plantillaId,
        bloque: input.bloque,
        eje: input.eje,
        observaciones: input.observaciones,
        items: input.items.map((i) => ({
          etiqueta: i.etiqueta,
          seccion: i.seccion,
          cumple: i.cumple,
          comentario: i.comentario,
          orden: i.orden,
        })),
        fotosMeta,
        firmasMeta,
      },
      fotos,
      resumen: { proyecto: input.proyecto, plantilla: input.plantilla, capturado_en },
    });
    return id;
  }

  /**
   * Q5 — solicita las firmas faltantes creando una notificación del SGC (misma
   * vía que la web) para el módulo de bitácora, con ruta al CL. Online-only.
   */
  async solicitarFirma(clId: string, obra: string, faltantes: string[]): Promise<void> {
    const msg = faltantes.length
      ? `Faltan firmas (${faltantes.join(', ')}) del checklist de liberación de ${obra}.`
      : `Revisa y firma el checklist de liberación de ${obra}.`;
    const { error } = await this.supabase.client.rpc('notificar_modulo', {
      p_modulo: 'bitacora',
      p_tipo: 'cl_firma',
      p_titulo: 'Firma de liberación pendiente',
      p_mensaje: msg,
      p_ruta: `/bitacora/cl/${clId}`,
    });
    if (error) throw new Error(error.message);
  }

  private registerHandler(): void {
    this.sync.register('cl_liberacion', async (payload, photoPaths) => {
      const items = payload['items'] as Array<{
        etiqueta: string;
        seccion: string | null;
        cumple: boolean | null;
        comentario: string | null;
        orden: number;
      }>;

      const fotosMeta = (payload['fotosMeta'] ?? []) as Array<{
        slot: string;
        correcto: boolean;
        descripcion: string | null;
      }>;
      const fotos = fotosMeta
        .filter((f) => photoPaths[f.slot])
        .map((f) => ({ storage_path: photoPaths[f.slot], correcto: f.correcto, descripcion: f.descripcion }));

      const firmasMeta = (payload['firmasMeta'] ?? []) as Array<{
        slot: string;
        rol: string;
        nombre: string | null;
        orden: number;
        metodo?: string;
      }>;
      const firmas = firmasMeta
        .filter((s) => photoPaths[s.slot])
        .map((s) => ({ rol: s.rol, usuario_id: null, nombre: s.nombre, firma_path: photoPaths[s.slot], orden: s.orden, metodo: s.metodo ?? 'pad' }));

      const { error } = await this.supabase.client.rpc('registrar_cl_app', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_plantilla_id: payload['plantilla_id'],
        p_elemento_id: null,
        p_vaciado_id: null,
        p_bloque: payload['bloque'] ?? null,
        p_eje: payload['eje'] ?? null,
        p_plano_path: photoPaths['plano'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_items: items,
        p_fotos: fotos,
        p_firmas: firmas,
        p_capturado_en: payload['capturado_en'],
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throw new PermanentSyncError(error.message);
    });
  }
}
