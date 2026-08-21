import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** AT2 — una referencia clickable a un registro que compone el puntaje. */
export interface IncentivoRef {
  id: string;
  /** 'ruta' | 'conduce' | 'echada' | 'inspeccion' | 'reporte_semanal'. */
  tipo: string;
  fecha: string;
  /** true si la actividad la hizo como AYUDANTE (no como titular). */
  ayudante: boolean;
}

/** AT2 — conteo de un renglón del informe de incentivo. */
export interface IncentivoRenglon {
  /** Actividades propias (como titular). */
  propio: number;
  /** Actividades donde fue ayudante. */
  ayudante: number;
  /** Puntos que aporta el renglón. */
  puntos: number;
  refs?: IncentivoRef[];
}

/** AT2 — informe de incentivo de una semana (RPC `incentivo_mi_rendimiento`). */
export interface IncentivoSemana {
  /** id del informe semanal (la RPC lo devuelve como `informe_id`). */
  informe_id: string;
  anio: number;
  semana: number;
  /** Inicio (lunes) y fin (domingo) de la semana, `YYYY-MM-DD`. */
  inicio: string;
  fin: string;
  puntaje: number;
  minimo: number;
  cumplio: boolean;
  /** `{ renglon: { propio, ayudante, puntos, refs[] } }`. */
  conteos: Record<string, IncentivoRenglon> | null;
  /** 'aprobado' | 'declinado' | null (pendiente de decisión). */
  decision: string | null;
  /** AT3 — motivo/nota de la decisión (sobre todo al declinar). */
  motivo: string | null;
  decidido_en: string | null;
}

/**
 * AT2 — "Mi rendimiento": el chofer ve SU propio informe de incentivo (semana en
 * curso + histórico) con el desglose por renglón y las referencias clickables a
 * cada registro. El backend (RPC `incentivo_mi_rendimiento`) ya filtra por
 * `auth.uid()` vía RLS, así que solo devuelve lo del usuario actual. Online
 * best-effort: el informe se recalcula server-side; no hay escritura desde aquí.
 */
@Injectable({ providedIn: 'root' })
export class IncentivoService {
  private supabase = inject(SupabaseService);

  async miRendimiento(): Promise<IncentivoSemana[]> {
    const { data, error } = await this.supabase.client.rpc('incentivo_mi_rendimiento');
    if (error) throw new Error(error.message);
    return (data as IncentivoSemana[]) ?? [];
  }
}
