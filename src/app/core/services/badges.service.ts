import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** DE-07 — detalle del conteo de un módulo (p. ej. inventario: por_recibir/por_despachar). */
export type BadgeDetalle = Record<string, number>;

/**
 * Q2/DE — conteos de pendientes por módulo para los badges del home. DE3: antes
 * cada módulo hacía su propia consulta global (p. ej. inventario contaba TODOS
 * los conduces "despachado" de la empresa, no los MÍOS) → el número del icono no
 * tenía relación con lo que el usuario veía al entrar. Ahora una SOLA llamada a
 * `badges_modulos_app()` (server, por usuario) es la fuente única de verdad:
 * mismo número arriba y adentro, por construcción. Best-effort y solo online;
 * si falla, no muestra badge (no se adivina un número).
 */
@Injectable({ providedIn: 'root' })
export class BadgesService {
  private supabase = inject(SupabaseService);

  private _counts = signal<Record<string, number>>({});
  counts = this._counts.asReadonly();

  /** DE-07 — detalle por módulo (p. ej. `{por_recibir: 3, por_despachar: 12}`). */
  private _detalle = signal<Record<string, BadgeDetalle>>({});
  detalle = this._detalle.asReadonly();

  async load(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('badges_modulos_app');
      if (error) throw error;
      const rows = (data ?? []) as { modulo: string; total: number; detalle: BadgeDetalle | null }[];
      const counts: Record<string, number> = {};
      const detalle: Record<string, BadgeDetalle> = {};
      for (const r of rows) {
        counts[r.modulo] = r.total;
        detalle[r.modulo] = r.detalle ?? {};
      }
      this._counts.set(counts);
      this._detalle.set(detalle);
    } catch {
      /* best-effort: sin conexión o sin permiso, no se muestra badge */
    }
  }
}
