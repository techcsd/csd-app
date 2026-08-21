import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * AT3 — "Gestión del incentivo" (solo logística/gerencia/admin). Aprobar o
 * declinar el incentivo de cada chofer por semana. Los informes se calculan
 * server-side; aquí solo se **decide** (aprobar/declinar), que es una acción
 * humana registrada — el informe no paga solo. Todos los RPCs ya existen en
 * prod y aplican el gate `puede_gestionar_incentivos()` server-side.
 */

/** Una semana con su resumen (RPC `incentivo_semanas`). */
export interface IncentivoGestionSemana {
  anio: number;
  semana: number;
  /** Inicio (lunes) y fin (domingo), `YYYY-MM-DD`. */
  inicio: string;
  fin: string;
  /** Total de choferes con informe esa semana. */
  choferes: number;
  /** Cuántos alcanzaron el mínimo. */
  cumplieron: number;
}

/** Una fila del listado por chofer de una semana (RPC `incentivo_listado`). */
export interface IncentivoGestionFila {
  informe_id: string;
  usuario_id: string;
  nombre: string;
  conductor_id: string | null;
  puntaje: number;
  minimo: number;
  cumplio: boolean;
  /** `{ renglon: { propio, ayudante, puntos, refs[] } }`. */
  conteos: Record<string, unknown> | null;
  /** Marcadores anti-inflado (puede venir `{}` vacío). */
  flags: Record<string, unknown> | null;
  /** 'aprobado' | 'declinado' | null (pendiente). */
  decision: string | null;
  motivo: string | null;
  decidido_por: string | null;
  decidido_por_nombre: string | null;
  decidido_en: string | null;
}

/** Una entrada del historial inmutable de decisiones (RPC `incentivo_historial`). */
export interface IncentivoDecisionHist {
  decision: string;
  motivo: string | null;
  puntaje: number;
  config_version: number;
  decidido_por: string | null;
  decidido_por_nombre: string | null;
  decidido_en: string;
}

@Injectable({ providedIn: 'root' })
export class IncentivoGestionService {
  private supabase = inject(SupabaseService);

  /** Gate: ¿el usuario actual puede gestionar el incentivo? (logística/gerencia/admin). */
  async puedeGestionar(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('puede_gestionar_incentivos');
    if (error) throw new Error(error.message);
    return data === true;
  }

  /** Lista de semanas con informe (más reciente primero). */
  async semanas(): Promise<IncentivoGestionSemana[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_semanas');
    if (error) throw new Error(error.message);
    return (data as IncentivoGestionSemana[]) ?? [];
  }

  /** Listado por chofer de una semana. */
  async listado(anio: number, semana: number): Promise<IncentivoGestionFila[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_listado', {
      p_anio: anio,
      p_semana: semana,
    });
    if (error) throw new Error(error.message);
    return (data as IncentivoGestionFila[]) ?? [];
  }

  /** Decide un informe (aprobar/declinar). Motivo obligatorio al declinar. */
  async decidir(informeId: string, decision: 'aprobado' | 'declinado', motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('incentivo_decidir', {
      p_informe_id: informeId,
      p_decision: decision,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  }

  /** Aprueba en bloque a todos los que alcanzaron el mínimo de la semana. */
  async aprobarCumplieron(anio: number, semana: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('incentivo_aprobar_cumplieron', {
      p_anio: anio,
      p_semana: semana,
    });
    if (error) throw new Error(error.message);
  }

  /** Historial inmutable de decisiones de un informe. */
  async historial(informeId: string): Promise<IncentivoDecisionHist[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_historial', {
      p_informe_id: informeId,
    });
    if (error) throw new Error(error.message);
    return (data as IncentivoDecisionHist[]) ?? [];
  }
}
