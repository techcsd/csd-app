import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  Agente,
  AgenteAccion,
  AgenteAprobacion,
  AgenteEvento,
  AgenteHallazgo,
  AgenteInformeDiario,
} from '../models/agentes.model';

/**
 * DF3 (PROMPT 129) — cliente de solo lectura (+ 2 RPC de decisión) para la
 * infraestructura de agentes del SGC. Gate real = RLS del servidor
 * (`sgc.is_admin() or sgc.es_tecnologia()`); la app solo decide si pinta el tile
 * (mismo patrón que el resto de la consola de Tecnología, CO8).
 */
@Injectable({ providedIn: 'root' })
export class AgentesService {
  private supabase = inject(SupabaseService);

  async listarAgentes(): Promise<Agente[]> {
    const { data, error } = await this.supabase.client.from('agentes').select('*').order('clave');
    if (error) throw new Error(error.message);
    return (data ?? []) as Agente[];
  }

  /** Último evento de cada agente (estado en vivo + "última acción"). */
  async ultimosEventos(): Promise<AgenteEvento[]> {
    const { data, error } = await this.supabase.client
      .from('agente_eventos')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as AgenteEvento[];
  }

  async hallazgosAbiertos(): Promise<AgenteHallazgo[]> {
    const { data, error } = await this.supabase.client
      .from('agente_hallazgos')
      .select('*')
      .in('estado', ['abierto', 'en_progreso'])
      .order('creado_en', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as AgenteHallazgo[];
  }

  /** "Lo que arreglaron solos" — últimas acciones Nivel 2 ejecutadas. */
  async accionesRecientes(): Promise<AgenteAccion[]> {
    const { data, error } = await this.supabase.client
      .from('agente_acciones')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []) as AgenteAccion[];
  }

  async aprobacionesPendientes(): Promise<AgenteAprobacion[]> {
    const { data, error } = await this.supabase.client
      .from('agente_aprobaciones')
      .select('*')
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AgenteAprobacion[];
  }

  async informeDeHoy(): Promise<AgenteInformeDiario | null> {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.supabase.client
      .from('agente_informes_diarios')
      .select('*')
      .eq('fecha', hoy)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as AgenteInformeDiario) ?? null;
  }

  async costoHoyTotal(): Promise<{ costo_hoy: number; tope_diario: number } | null> {
    const { data, error } = await this.supabase.client.rpc('agentes_costo_hoy_total');
    if (error) throw new Error(error.message);
    const fila = Array.isArray(data) ? data[0] : data;
    return fila ?? null;
  }

  /** "Aprobar para dev" nunca mezcla a main — solo marca el estado (regla 18, lo hace Xaviel en GitHub). */
  async decidirAprobacion(id: string, decision: 'aprobada' | 'ajuste' | 'descartada', nota?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('decidir_agente_aprobacion', {
      p_id: id,
      p_decision: decision,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** "Deshacer" solo marca la acción como deshecha — si fue una notificación ya enviada, NO la retira (el servidor no finge revertir lo irreversible). */
  async deshacerAccion(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('deshacer_agente_accion', { p_id: id });
    if (error) throw new Error(error.message);
  }

  /** Realtime (mismo patrón que mensajes.service.ts) — nuevo evento de cualquier agente. Devuelve el "unsubscribe". */
  suscribirEventos(onInsert: () => void): () => void {
    const channel = this.supabase.client
      .channel(`agente-eventos-app-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'agente_eventos' }, () => onInsert())
      .subscribe();
    return () => {
      void this.supabase.client.removeChannel(channel);
    };
  }
}
