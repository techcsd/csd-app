import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TecClaveRevelada {
  valor: string;
  tipo_clave: 'personal' | 'compartida';
  visible_segundos: number;
}

/**
 * DA4/DA6/A3 — cliente app de la edge `equipos-clave`. Alcance móvil MÁS
 * ESTRECHO que la web (mismo patrón que el Vault, BovedaService): la app SOLO
 * ve (accion "ver") — crear/editar/quitar la clave es solo web (DA-19). Nunca
 * persiste el valor en claro: el llamador lo guarda únicamente en un signal de
 * componente, nunca en Dexie/Preferences/localStorage. Sin sesión de
 * reautenticación propia (esta pieza NO es el Vault) — el gate real es
 * `sgc.puede_ver_claves_equipos()` del lado del servidor; `UserContextService
 * .puedeVerClavesEquipos()` solo decide si se pinta el bloque.
 */
@Injectable({ providedIn: 'root' })
export class TecClaveService {
  private supabase = inject(SupabaseService);

  async ver(equipoId: string): Promise<TecClaveRevelada> {
    const { data, error } = await this.supabase.client.functions.invoke('equipos-clave', {
      body: { accion: 'ver', equipo_id: equipoId },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            throw new Error(String((parsed as { error: unknown }).error));
          }
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
        }
      }
      throw new Error(error.message);
    }
    const d = data as { ok: boolean; error?: string; valor?: string; tipo_clave?: 'personal' | 'compartida'; visible_segundos?: number };
    if (!d.ok || !d.valor) throw new Error(d.error ?? 'No se pudo obtener la clave.');
    return { valor: d.valor, tipo_clave: d.tipo_clave ?? 'compartida', visible_segundos: d.visible_segundos ?? 30 };
  }
}
