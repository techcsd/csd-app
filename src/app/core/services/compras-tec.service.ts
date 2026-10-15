import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompraTecAdjunto, CompraTecDetalle, CompraTecRow } from '../models/compra-tec.model';

const BUCKET = 'compras-cotizaciones';

/**
 * CO8 — "Compras tecnológicas" en la app: SOLO la parte del aprobador (ver +
 * aprobar/rechazar con vista previa de la cotización). Crear/adjuntar sigue
 * siendo trabajo de la web (Tecnología). Sin RPC de listado del padre — se lee
 * `solicitudes_compra` directo (RLS). **Hueco conocido**: la policy de SELECT de
 * esa tabla es `solicitante_id = auth.uid() or is_admin() or tiene_modulo('compras')`
 * — NO incluye `aprobador_id = auth.uid()`, así que si Eduardo (el aprobador por
 * default) no tiene el módulo compras/admin, esta pantalla le sale vacía aunque
 * SÍ pueda decidir vía `compra_tec_decidir` (ese RPC sí lo autoriza). Avisado al
 * padre (PARIDAD.md); 1 línea de RLS lo cierra.
 */
@Injectable({ providedIn: 'root' })
export class ComprasTecService {
  private supabase = inject(SupabaseService);

  /** Compras tecnológicas esperando aprobación (RLS las acota a lo que el usuario puede ver). */
  async pendientesDeAprobar(): Promise<CompraTecRow[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select('id, estado, notas, created_at, enviada_at, solicitante_id, aprobador_id')
      .eq('categoria', 'tecnologia')
      .eq('estado', 'esperando_aprobacion')
      .order('enviada_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as CompraTecRow[]).map((r) => ({ ...r }));
    await Promise.all([this.resolverNombres(rows), this.resolverTotales(rows)]);
    return rows;
  }

  async detalle(id: string): Promise<CompraTecDetalle | null> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select(
        'id, estado, notas, created_at, enviada_at, solicitante_id, aprobador_id, decidida_por, decidida_at, motivo_rechazo',
      )
      .eq('id', id)
      .eq('categoria', 'tecnologia')
      .maybeSingle();
    if (error || !data) return null;

    const [itemsRes, adjRes] = await Promise.all([
      this.supabase.client
        .from('solicitud_compra_items')
        .select('id, descripcion, cantidad, proveedor_sugerido, precio_unitario')
        .eq('solicitud_id', id),
      this.supabase.client
        .from('solicitud_compra_adjuntos')
        .select('id, tipo, proveedor, monto, path, nombre, elegida, created_at')
        .eq('solicitud_id', id)
        .order('created_at', { ascending: true }),
    ]);

    const det: CompraTecDetalle = {
      ...(data as Omit<CompraTecDetalle, 'items' | 'adjuntos'>),
      items: (itemsRes.data ?? []) as CompraTecDetalle['items'],
      adjuntos: (adjRes.data ?? []) as CompraTecAdjunto[],
    };
    await this.resolverNombres([det]);
    await Promise.all(det.adjuntos.map(async (a) => (a.url = await this.firmarAdjunto(a.path))));
    return det;
  }

  /** `p_motivo` obligatorio cuando `aprobar=false` (el RPC lo exige, 22023 si falta). */
  async decidir(id: string, aprobar: boolean, motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('compra_tec_decidir', {
      p_id: id,
      p_aprobar: aprobar,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  private async firmarAdjunto(path: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Nombres de solicitante/aprobador vía `usuarios_por_ids` (RLS-safe; `usuarios` es admin-only). */
  private async resolverNombres(
    rows: Array<{
      solicitante_id: string;
      aprobador_id: string | null;
      solicitante_nombre?: string | null;
      aprobador_nombre?: string | null;
    }>,
  ): Promise<void> {
    const ids = [...new Set(rows.flatMap((r) => [r.solicitante_id, r.aprobador_id]).filter(Boolean))] as string[];
    if (!ids.length) return;
    try {
      const { data } = await this.supabase.client.rpc('usuarios_por_ids', { p_ids: ids });
      const map = new Map(((data as { id: string; nombre: string }[]) ?? []).map((u) => [u.id, u.nombre]));
      for (const r of rows) {
        r.solicitante_nombre = map.get(r.solicitante_id) ?? null;
        r.aprobador_nombre = r.aprobador_id ? (map.get(r.aprobador_id) ?? null) : null;
      }
    } catch {
      /* best-effort: la tarjeta se queda sin nombre */
    }
  }

  private async resolverTotales(rows: CompraTecRow[]): Promise<void> {
    if (!rows.length) return;
    try {
      const { data } = await this.supabase.client
        .from('solicitud_compra_items')
        .select('solicitud_id, cantidad, precio_unitario')
        .in(
          'solicitud_id',
          rows.map((r) => r.id),
        );
      const totales = new Map<string, number>();
      for (const it of (data ?? []) as { solicitud_id: string; cantidad: number; precio_unitario: number | null }[]) {
        const t = (it.precio_unitario ?? 0) * (it.cantidad ?? 0);
        totales.set(it.solicitud_id, (totales.get(it.solicitud_id) ?? 0) + t);
      }
      for (const r of rows) r.total = totales.get(r.id) ?? null;
    } catch {
      /* best-effort */
    }
  }
}
