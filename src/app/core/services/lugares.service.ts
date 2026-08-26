import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** Un lugar del SISTEMA (obra, almacén o POI promovido) devuelto por buscar_lugares. */
export interface LugarSistema {
  tipo: 'obra' | 'almacen' | 'lugar';
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  detalle: string | null;
}

/**
 * BA/Transporte v3 (FASE 3) — lugares registrados del sistema para el buscador
 * mejorado del selector de lugar. Arregla el bug "Bellón": obras/almacenes/POIs
 * que SÍ existen y el buscador de mapas no devolvía. Se une en el cliente con la
 * búsqueda de Google/Nominatim (GeocodingService). RPC `buscar_lugares` (AZ8/BA).
 */
@Injectable({ providedIn: 'root' })
export class LugaresService {
  private supabase = inject(SupabaseService);

  /** Busca lugares del sistema por nombre (mínimo 2 caracteres). Best-effort. */
  async buscar(q: string): Promise<LugarSistema[]> {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    try {
      const { data, error } = await this.supabase.client.rpc('buscar_lugares', { p_q: term });
      if (error || !Array.isArray(data)) return [];
      return (data as LugarSistema[]).map((r) => ({
        tipo: r.tipo,
        id: r.id,
        nombre: r.nombre,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null,
        detalle: r.detalle ?? null,
      }));
    } catch {
      return [];
    }
  }
}
