import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';

/**
 * Q2 — conteos de pendientes por módulo para los badges del home. Reutiliza las
 * MISMAS tablas/estados que `pendingByModulo` de la web (no inventa sistema
 * nuevo). Best-effort y solo online; si falla, no muestra badge.
 */
@Injectable({ providedIn: 'root' })
export class BadgesService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  private _counts = signal<Record<string, number>>({});
  counts = this._counts.asReadonly();

  async load(): Promise<void> {
    const tasks: Promise<void>[] = [];
    // Flota: avisos de flota pendientes (misma fuente que la web).
    if (this.ctx.hasModulo('flota')) tasks.push(this.count('avisos_flota', 'estado', 'pendiente', 'flota'));
    // Inventario: conduces despachados por recibir.
    if (this.ctx.hasModulo('inventario')) tasks.push(this.count('salidas_inventario', 'estado', 'despachado', 'inventario'));
    await Promise.allSettled(tasks);
  }

  private async count(table: string, col: string, val: string, modulo: string): Promise<void> {
    try {
      const { count } = await this.supabase.client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq(col, val);
      this._counts.update((m) => ({ ...m, [modulo]: count ?? 0 }));
    } catch {
      /* best-effort: sin conexión o sin permiso, no se muestra badge */
    }
  }
}
