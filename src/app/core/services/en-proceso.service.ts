import { effect, inject, Injectable, signal } from '@angular/core';
import { db } from '../db/app-db';
import { SyncService } from '../sync/sync.service';

/** V1 — módulos que tienen "documentación en proceso" (borradores + envíos). */
export type EnProcesoModulo = 'bitacora' | 'flota';

/** Un ítem "en proceso": un borrador (Dexie) o un envío en la cola (outbox). */
export interface EnProcesoItem {
  kind: 'borrador' | 'envio';
  /** clave del borrador o id de la op del outbox. */
  id: string;
  tipo: string;
  etiqueta: string;
  /** ms — para ordenar (updated_at del borrador / created_local del envío). */
  updated_at: number;
  /** ruta para retomar el borrador. */
  ruta?: string;
  /** parte/incidente se retoman por su clave (?borrador=). */
  resumePorClave?: boolean;
  /** solo envíos: estado visible. */
  estado?: 'enviando' | 'error';
  error?: string;
}

// Módulo → tipos de borrador (Dexie) y tipos de op del outbox que le pertenecen.
const BORRADOR_TIPOS: Record<EnProcesoModulo, string[]> = {
  bitacora: ['parte', 'incidente'],
  flota: ['checklist', 'vehiculo', 'conductor'],
};
const OUTBOX_TIPOS: Record<EnProcesoModulo, string[]> = {
  bitacora: ['bitacora'],
  flota: [
    'vehiculo_entrega',
    'combustible',
    'checklist_preuso',
    'reporte_semanal',
    'mantenimiento',
    'crear_ruta',
    'accidente_vehiculo',
    'dano_vehiculo',
    'multa_conductor',
  ],
};

const OP_LABEL: Record<string, string> = {
  bitacora: 'Bitácora',
  vehiculo_entrega: 'Recibir/entregar vehículo',
  combustible: 'Registrar combustible',
  checklist_preuso: 'Checklist de pre-uso',
  reporte_semanal: 'Reporte semanal',
  mantenimiento: 'Reporte de mantenimiento',
  crear_ruta: 'Ruta',
  accidente_vehiculo: 'Reporte de accidente',
  dano_vehiculo: 'Reporte de daño',
  multa_conductor: 'Multa',
};
const BORRADOR_LABEL: Record<string, string> = {
  parte: 'Bitácora del día',
  incidente: 'Reporte de incidente',
  checklist: 'Checklist de vehículo',
  vehiculo: 'Vehículo',
  conductor: 'Conductor',
};

const RESUME_POR_CLAVE = new Set(['parte', 'incidente']);

/**
 * V1 — "Documentación en proceso" reutilizable por módulo: une los borradores de
 * Dexie (formularios a medio llenar) con los envíos aún en la cola del outbox
 * (capturados pero sin confirmar por el servidor). Alimenta la sección de "Mis
 * bitácoras", los accesos dentro de cada hub y los contadores del home.
 */
@Injectable({ providedIn: 'root' })
export class EnProcesoService {
  private sync = inject(SyncService);

  private _counts = signal<Record<string, number>>({});
  counts = this._counts.asReadonly();

  constructor() {
    // Se refresca solo con cada cambio del outbox (encolar/drenar/error).
    effect(() => {
      this.sync.changed();
      void this.refresh();
    });
  }

  /** Recalcula los contadores por módulo (para los badges del home/hub). */
  async refresh(): Promise<void> {
    const [bitacora, flota] = await Promise.all([
      this.list('bitacora'),
      this.list('flota'),
    ]);
    this._counts.set({ bitacora: bitacora.length, flota: flota.length });
  }

  async count(modulo: EnProcesoModulo): Promise<number> {
    return (await this.list(modulo)).length;
  }

  /** Borradores + envíos pendientes del módulo, más recientes primero. */
  async list(modulo: EnProcesoModulo): Promise<EnProcesoItem[]> {
    const borradorTipos = new Set(BORRADOR_TIPOS[modulo]);
    const outboxTipos = new Set(OUTBOX_TIPOS[modulo]);
    const [drafts, ops] = await Promise.all([
      db.borradores.toArray(),
      db.outbox.where('estado').anyOf('pending', 'syncing', 'error').toArray(),
    ]);

    const items: EnProcesoItem[] = [];
    for (const b of drafts) {
      if (!b.tipo || !borradorTipos.has(b.tipo)) continue;
      items.push({
        kind: 'borrador',
        id: b.clave,
        tipo: b.tipo,
        etiqueta: b.etiqueta || BORRADOR_LABEL[b.tipo] || 'Documento sin enviar',
        updated_at: b.updated_at,
        ruta: b.ruta,
        resumePorClave: RESUME_POR_CLAVE.has(b.tipo),
      });
    }
    for (const op of ops) {
      if (!outboxTipos.has(op.tipo_op)) continue;
      items.push({
        kind: 'envio',
        id: op.id,
        tipo: op.tipo_op,
        etiqueta: OP_LABEL[op.tipo_op] || 'Envío pendiente',
        updated_at: op.created_local,
        estado: op.estado === 'error' ? 'error' : 'enviando',
        error: op.error_msg,
      });
    }
    return items.sort((a, b) => b.updated_at - a.updated_at);
  }
}
