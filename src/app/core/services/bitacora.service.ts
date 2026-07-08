import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { PermanentSyncError, SyncService } from '../sync/sync.service';
import { ActividadEntry, Proyecto } from '../models/bitacora.model';
import { db, RegistroLocal } from '../db/app-db';

const CATALOG_PROYECTOS = 'proyectos';
const BUCKET = 'sgc-bitacora';

export interface ParteDiarioCaptura {
  proyectoId: string;
  personalCarpinteria: number;
  personalAcero: number;
  trabajadoresCasa: number;
  otroPersonal: string | null;
  actividades: ActividadEntry[];
  restricciones: string[];
  comentarios: string | null;
  fotos: Blob[];
}

export interface IncidenteCaptura {
  proyectoId: string;
  tipo: 'incidente' | 'accidente';
  gravedad: string;
  lesionados: number;
  descripcion: string | null;
  fotos: Blob[];
}

/**
 * Bitácora writes (parte diario / incidente) through the offline outbox,
 * committed by sgc.crear_bitacora_app. Photos upload to the existing
 * sgc-bitacora bucket. Proyectos are cached for offline obra selection.
 */
@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>(CATALOG_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre')
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  async enqueueParteDiario(input: ParteDiarioCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'bitacora',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        fecha: capturado_en.slice(0, 10),
        tipo: 'parte_diario',
        comentarios: input.comentarios,
        personal_carpinteria: input.personalCarpinteria,
        personal_acero: input.personalAcero,
        trabajadores_casa: input.trabajadoresCasa,
        otro_personal: input.otroPersonal,
        actividades: input.actividades,
        restricciones: input.restricciones.map((r) => ({ tipo_restriccion: r, descripcion_otro: null })),
        capturado_en,
      },
      fotos: this.buildFotos(id, input.fotos),
      resumen: { tipo: 'parte_diario', proyecto_id: input.proyectoId, capturado_en },
    });
  }

  async enqueueIncidente(input: IncidenteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'bitacora',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        fecha: capturado_en.slice(0, 10),
        tipo: 'incidente',
        incidente_tipo: input.tipo,
        incidente_gravedad: input.gravedad,
        incidente_lesionados: input.lesionados,
        incidente_descripcion: input.descripcion,
        capturado_en,
      },
      fotos: this.buildFotos(id, input.fotos),
      resumen: { tipo: 'incidente', proyecto_id: input.proyectoId, capturado_en },
    });
  }

  /** Local list of parts I've captured (offline-friendly "Mis partes"). */
  async misPartesLocales(): Promise<RegistroLocal[]> {
    const rows = await db.mis_registros.where('tipo_op').equals('bitacora').toArray();
    return rows.sort((a, b) => b.created_local - a.created_local);
  }

  private buildFotos(id: string, blobs: Blob[]) {
    return blobs.map((blob, i) => ({
      id: crypto.randomUUID(),
      bucket: BUCKET,
      path: `${id}/foto_${i}.jpg`,
      slot: `foto_${i}`,
      blob,
    }));
  }

  private registerHandler(): void {
    this.sync.register('bitacora', async (payload, photoPaths) => {
      const fotos = Object.keys(photoPaths).map((slot) => ({
        path: photoPaths[slot],
        nombre: `${slot}.jpg`,
        tipo_mime: 'image/jpeg',
      }));
      const { error } = await this.supabase.client.rpc('crear_bitacora_app', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_fecha: payload['fecha'],
        p_tipo: payload['tipo'],
        p_comentarios: payload['comentarios'] ?? null,
        p_personal_carpinteria: payload['personal_carpinteria'] ?? 0,
        p_personal_acero: payload['personal_acero'] ?? 0,
        p_trabajadores_casa: payload['trabajadores_casa'] ?? 0,
        p_otro_personal: payload['otro_personal'] ?? null,
        p_actividades: payload['actividades'] ?? [],
        p_restricciones: payload['restricciones'] ?? [],
        p_incidente_tipo: payload['incidente_tipo'] ?? null,
        p_incidente_gravedad: payload['incidente_gravedad'] ?? null,
        p_incidente_lesionados: payload['incidente_lesionados'] ?? 0,
        p_incidente_descripcion: payload['incidente_descripcion'] ?? null,
        p_incidente_acciones: payload['incidente_acciones'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throw new PermanentSyncError(error.message);
    });
  }
}
