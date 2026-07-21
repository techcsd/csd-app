import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { PermanentSyncError, SyncService } from '../sync/sync.service';
import {
  ClCaptura,
  ClFirmaRol,
  ClPendiente,
  ClPlantilla,
  ClProyecto,
  ClRegistroDetalle,
  CL_FIRMA_ROLES,
} from '../models/cl-liberacion.model';

/** Forma cruda de la fila de cl_registros con sus joins (Q5 3b). */
interface ClRow {
  id: string;
  estado?: string;
  bloque?: string | null;
  eje?: string | null;
  observaciones?: string | null;
  plano_path?: string | null;
  created_at: string;
  proyecto?: { nombre: string } | null;
  plantilla?: { codigo: string; nombre: string } | null;
  firmas?: { rol: string; nombre?: string | null; metodo?: string | null; firmado_en?: string | null; firma_path?: string | null }[];
  items?: { etiqueta: string; seccion?: string | null; cumple?: boolean | null; comentario?: string | null; orden?: number | null }[];
  fotos?: { storage_path: string; correcto?: boolean | null; descripcion?: string | null }[];
}

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

  // ── Q5 (3b) — firmar un CL existente desde el aviso / bandeja ──────────────

  /** CLs en borrador pendientes de firma (para la bandeja "por firmar"). Online. */
  async getClsPendientes(): Promise<ClPendiente[]> {
    const { data, error } = await this.supabase.client
      .from('cl_registros')
      .select('id, created_at, proyecto:proyectos(nombre), plantilla:cl_plantillas(codigo, nombre), firmas:cl_registro_firmas(rol)')
      .eq('estado', 'borrador')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((data as unknown as ClRow[]) ?? []).map((d) => {
      const roles = new Set((d.firmas ?? []).map((f) => f.rol));
      const faltantes = CL_FIRMA_ROLES.filter((r) => r.obligatoria && !roles.has(r.value)).map((r) => r.label);
      return {
        id: d.id,
        proyecto: d.proyecto?.nombre ?? '—',
        plantilla: d.plantilla?.nombre ?? '—',
        created_at: d.created_at,
        faltantes,
      };
    });
  }

  /**
   * S14 — un CL COMPLETO para revisarlo read-only antes de firmar: cabecera,
   * ítems (cumple/no cumple + comentarios), fotos, plano, observaciones y firmas
   * ya puestas (con la imagen de la firma). Online.
   */
  async getCl(id: string): Promise<ClRegistroDetalle | null> {
    const { data, error } = await this.supabase.client
      .from('cl_registros')
      .select(
        'id, estado, bloque, eje, observaciones, plano_path, created_at, proyecto:proyectos(nombre), plantilla:cl_plantillas(codigo, nombre), firmas:cl_registro_firmas(rol, nombre, metodo, firmado_en, firma_path), items:cl_registro_items(etiqueta, seccion, cumple, comentario, orden), fotos:cl_registro_fotos(storage_path, correcto, descripcion)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const d = data as unknown as ClRow;

    // URLs firmadas del bucket privado `obra` para plano/fotos/firmas.
    const planoUrl = d.plano_path ? await this.signObra(d.plano_path) : null;
    const fotos = await Promise.all(
      (d.fotos ?? []).map(async (f) => ({
        url: (await this.signObra(f.storage_path)) ?? '',
        correcto: f.correcto ?? null,
        descripcion: f.descripcion ?? null,
      })),
    );
    const firmas = await Promise.all(
      (d.firmas ?? []).map(async (f) => ({
        rol: f.rol,
        nombre: f.nombre ?? null,
        metodo: f.metodo ?? null,
        firmado_en: f.firmado_en ?? null,
        firma_url: f.firma_path ? await this.signObra(f.firma_path) : null,
      })),
    );

    return {
      id: d.id,
      estado: d.estado ?? 'borrador',
      bloque: d.bloque ?? null,
      eje: d.eje ?? null,
      observaciones: d.observaciones ?? null,
      created_at: d.created_at,
      proyecto: d.proyecto?.nombre ?? '—',
      plantilla: d.plantilla?.nombre ?? '—',
      plantillaCodigo: d.plantilla?.codigo ?? '',
      firmas,
      items: [...(d.items ?? [])]
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        .map((i) => ({
          etiqueta: i.etiqueta,
          seccion: i.seccion ?? null,
          cumple: i.cumple ?? null,
          comentario: i.comentario ?? null,
        })),
      fotos: fotos.filter((f) => f.url),
      planoUrl,
    };
  }

  /** URL firmada de un objeto del bucket privado `obra` (1h). Null si falla. */
  private async signObra(path: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  }

  /**
   * Firma un CL existente: sube la firma (trazo o foto) al bucket `obra` y la
   * inserta en `cl_registro_firmas` (reemplaza la del mismo rol). El trigger
   * `trg_cl_firmado` pasa el CL a 'firmado' al tener Residente + Responsable.
   * Online-only (no outbox: la firma se hace sobre un CL ya en el servidor).
   */
  async firmarCl(input: { clId: string; rol: ClFirmaRol; nombre: string | null; blob: Blob; metodo: 'pad' | 'foto' }): Promise<void> {
    const ext = input.metodo === 'foto' ? 'jpg' : 'png';
    const contentType = input.metodo === 'foto' ? 'image/jpeg' : 'image/png';
    const path = `cl/${input.clId}/firma_${input.rol}.${ext}`;
    const up = await this.supabase.client.storage.from(BUCKET).upload(path, input.blob, { upsert: true, contentType });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error(up.error.message);
    const { data: userData } = await this.supabase.client.auth.getUser();
    const uid = userData.user?.id ?? null;
    // Reemplaza la firma previa del mismo rol (evita duplicados).
    await this.supabase.client.from('cl_registro_firmas').delete().eq('registro_id', input.clId).eq('rol', input.rol);
    const { error } = await this.supabase.client.from('cl_registro_firmas').insert({
      registro_id: input.clId,
      rol: input.rol,
      usuario_id: uid,
      nombre: input.nombre,
      firma_path: path,
      metodo: input.metodo,
      orden: 0,
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
