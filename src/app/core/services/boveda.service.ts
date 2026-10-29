import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { BovedaEntrada } from '../models/boveda.model';

export interface BovedaRevelado {
  valor: string;
  visible_segundos: number;
}

/**
 * CZ3/CZ9/CZ7 — cliente app de la edge `boveda`. Alcance móvil (DZ-19): SOLO
 * buscar/ver/revelar/copiar/código 2FA (más el generador, que es puro cliente
 * y vive en boveda-generador.util.ts). Crear/editar/eliminar/importar/exportar
 * NO existen aquí a propósito — son trabajo de la web.
 *
 * Nunca persiste un valor en claro: cada método devuelve el dato al llamador,
 * que lo guarda SOLO en un signal de componente (memoria), nunca en Dexie,
 * Preferences, localStorage ni ningún otro storage del dispositivo.
 *
 * El header `x-sgc-client: app` es lo que hace que la edge dé una sesión de
 * 2 minutos en vez de los 5 de la web (DZ-10/SESION_MINUTOS en el edge).
 */
@Injectable({ providedIn: 'root' })
export class BovedaService {
  private supabase = inject(SupabaseService);

  private async invocar<T = unknown>(accion: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.supabase.client.functions.invoke('boveda', {
      body: { accion, ...payload },
      headers: { 'x-sgc-client': 'app' },
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
    const d = data as { ok: boolean; error?: string };
    if (!d.ok) throw new Error(d.error ?? 'No se pudo completar la operación.');
    return data as T;
  }

  // ── Metadata (lista, sin pasar por la edge — no es secreta) ────────────────
  async listar(): Promise<BovedaEntrada[]> {
    const { data, error } = await this.supabase.client
      .from('boveda_entradas')
      .select(
        'id, tipo, nombre, sitio_url, usuario_texto, archivo_path, archivo_nombre, archivo_mime, etiquetas, rotar_cada_dias, ultima_rotacion, notas, creado_por, created_at, updated_at',
      )
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BovedaEntrada[];
  }

  async sesionVigenteHasta(): Promise<Date | null> {
    const { data, error } = await this.supabase.client.rpc('boveda_sesion_vigente');
    if (error || !data) return null;
    return new Date(data as string);
  }

  // ── Edge (reautenticación + descifrado) ────────────────────────────────────
  async abrirSesion(password: string): Promise<{ expira_at: string }> {
    return this.invocar('sesion_abrir', { password });
  }

  async revelar(entradaId: string): Promise<BovedaRevelado> {
    return this.invocar('revelar', { entrada_id: entradaId });
  }

  async codigo2fa(entradaId: string): Promise<{ codigo: string; segundos_restantes: number }> {
    return this.invocar('codigo_2fa', { entrada_id: entradaId });
  }

  /** Auditoría de "copiar" (el valor ya estaba en memoria del componente; esto solo deja rastro). */
  async registrarCopia(entradaId: string): Promise<void> {
    await this.invocar('copiar_evento', { entrada_id: entradaId });
  }
}
