import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * AV7 — map-matching: pega una polyline cruda a las calles vía la edge function
 * `snap-to-roads` (Google Roads API, cacheada server-side en sgc.snap_cache por
 * hash de contenido → cada tramo se paga una sola vez). Degradación elegante:
 * si la edge falla o no hay red, devuelve los puntos CRUDOS (nunca rompe el mapa).
 * Cachea también en memoria por sesión para no re-invocar el mismo tramo.
 */
@Injectable({ providedIn: 'root' })
export class MapMatchingService {
  private supabase = inject(SupabaseService);
  private cache = new Map<string, [number, number][]>();

  private clave(coords: [number, number][]): string {
    const a = coords[0];
    const b = coords[coords.length - 1];
    return `${coords.length}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  }

  async snap(coords: [number, number][]): Promise<[number, number][]> {
    if (!coords || coords.length < 2) return coords ?? [];
    const key = this.clave(coords);
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const { data, error } = await this.supabase.client.functions.invoke('snap-to-roads', {
        body: { coords },
      });
      if (error) return coords;
      const snapped = (data?.coords as [number, number][] | undefined) ?? coords;
      const out = Array.isArray(snapped) && snapped.length >= 2 ? snapped : coords;
      this.cache.set(key, out);
      return out;
    } catch {
      return coords;
    }
  }
}
