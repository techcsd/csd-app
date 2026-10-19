import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  ClaudeBorrador,
  ClaudeBorradorDetalleLinea,
  ClaudeConectorConfig,
  ClaudeMiConexion,
} from '../models/claude-conector.model';

/**
 * CR1 — Conector de Claude Desktop. La app solo MUESTRA el estado y deja
 * desconectar/revisar borradores — conectar (OAuth) es solo-web (contrato en
 * `SGC/PARIDAD.md` § "CR1 — Conector de Claude Desktop (contrato para la app,
 * PROMPT-105)"). Online-only (no pasa por el outbox: es una confirmación puntual).
 */
@Injectable({ providedIn: 'root' })
export class ClaudeConectorService {
  private supabase = inject(SupabaseService);

  async miConexion(): Promise<ClaudeMiConexion | null> {
    const { data, error } = await this.supabase.client.rpc('claude_mi_conexion');
    if (error) throw new Error(error.message);
    return (data as ClaudeMiConexion) ?? null;
  }

  /** Si el conector está apagado globalmente (`claude_conector_activo=false`). */
  async config(): Promise<ClaudeConectorConfig | null> {
    const { data, error } = await this.supabase.client.rpc('claude_conector_config');
    if (error) return null; // best-effort: si falla, la pantalla asume "activo" (no bloquea sin certeza)
    return (data as ClaudeConectorConfig) ?? null;
  }

  /** Borradores propios pendientes y sin caducar (RLS ya filtra a `usuario_id = auth.uid()`). */
  async borradoresPendientes(): Promise<ClaudeBorrador[]> {
    const { data, error } = await this.supabase.client
      .from('claude_borradores')
      .select('id, tool, params, resumen, estado, creado_en, expira_en, resultado')
      .eq('estado', 'pendiente')
      .gt('expira_en', new Date().toISOString())
      .order('creado_en', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaudeBorrador[];
  }

  /** `get` — borrador + nombres ya resueltos por el servidor (obra, artículos). */
  async obtenerBorrador(id: string): Promise<{ borrador: ClaudeBorrador; detalle: ClaudeBorradorDetalleLinea[] }> {
    const { data, error } = await this.supabase.client.functions.invoke('claude-borrador', {
      body: { accion: 'get', id },
    });
    if (error) throw new Error((await this.readEdgeError(error)).error ?? 'No se pudo abrir el borrador.');
    return data as { borrador: ClaudeBorrador; detalle: ClaudeBorradorDetalleLinea[] };
  }

  /** `confirmar` — AU1, idempotente: confirmar dos veces nunca duplica el documento. */
  async confirmar(id: string): Promise<{ ok: boolean; mensaje: string; duplicado?: boolean }> {
    const { data, error } = await this.supabase.client.functions.invoke('claude-borrador', {
      body: { accion: 'confirmar', id },
    });
    if (error) throw new Error((await this.readEdgeError(error)).error ?? 'No se pudo confirmar el borrador.');
    return data as { ok: boolean; mensaje: string; duplicado?: boolean };
  }

  async descartar(id: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.functions.invoke('claude-borrador', {
      body: { accion: 'descartar', id },
    });
    if (error) throw new Error((await this.readEdgeError(error)).error ?? 'No se pudo descartar el borrador.');
    return !!(data as { ok?: boolean })?.ok;
  }

  /** Corta las conexiones OAuth de Claude de la propia persona (self-service). */
  async desconectar(): Promise<number> {
    const { data, error } = await this.supabase.client.functions.invoke('claude-conexiones', {
      body: { accion: 'desconectar' },
    });
    if (error) throw new Error((await this.readEdgeError(error)).error ?? 'No se pudo desconectar.');
    return Number((data as { revocados?: number })?.revocados ?? 0);
  }

  /** AU16 — con supabase-js, en un status !=2xx `error.context` es la Response de la
   *  edge; hay que leer su body JSON para sacar el mensaje útil. */
  private async readEdgeError(error: unknown): Promise<{ error?: string }> {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      try {
        return await ctx.clone().json();
      } catch {
        /* body no-JSON */
      }
    }
    const legacy = (error as { context?: { error?: string }; message?: string })?.context?.error;
    return { error: legacy || (error as Error)?.message };
  }
}
