import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';

/** Matches the crear_reporte_app RPC domain (tipo ∈ 'duda'|'error'|'mejora'). */
export type ReporteTipo = 'error' | 'mejora' | 'duda';

/** Input the "Reportar problema/mejora" form hands to enqueueReporte(). */
export interface ReporteCaptura {
  tipo: ReporteTipo;
  asunto: string;
  descripcion: string;
}

/**
 * App feedback write path (pilot users report a problem / suggestion / question).
 * Mirrors MantenimientosService: the report is enqueued in the offline outbox and
 * committed by the registered handler (crear_reporte_app, idempotent by p_id) as
 * soon as there's connectivity. Photo-less op — no fotos on the enqueue.
 */
@Injectable({ providedIn: 'root' })
export class ReportesService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Queue an app report. Works fully offline; syncs when there's signal. */
  async enqueueReporte(input: ReporteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const asunto = input.asunto.trim();
    const descripcion = input.descripcion.trim();

    await this.sync.enqueue({
      id,
      tipo_op: 'reporte',
      payload: { id, tipo: input.tipo, asunto, descripcion },
      resumen: { tipo: input.tipo, asunto },
    });
  }

  private registerHandler(): void {
    this.sync.register('reporte', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_reporte_app', {
        p_id: payload['id'],
        p_tipo: payload['tipo'],
        p_asunto: payload['asunto'],
        p_descripcion: payload['descripcion'],
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);
    });
  }
}
