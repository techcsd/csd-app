import { inject, Injectable } from '@angular/core';
import { GeocodingService } from './geocoding.service';
import { ConducesService } from './conduces.service';

/**
 * U13 — traduce coordenadas GPS a una etiqueta legible para el usuario de campo:
 *  1) match por cercanía (≤200 m) contra obras/almacenes (coords en BD) →
 *     "📍 Proyecto X" / "📍 Almacén X";
 *  2) si no hay match, reverse geocode (Nominatim, ya usado en rutas) →
 *     "Calle, sector, ciudad" (corto);
 *  3) fallback "📍 Capturada".
 * Mismo criterio en cualquier lugar que muestre una ubicación capturada.
 */
@Injectable({ providedIn: 'root' })
export class UbicacionLabelService {
  private geocoding = inject(GeocodingService);
  private conduces = inject(ConducesService);

  private static readonly RADIO_M = 200;

  async describir(lat: number, lng: number): Promise<string> {
    // 1) cercanía contra obras/almacenes
    try {
      const lugares = await this.conduces.getLugaresDestino();
      let best: { nombre: string; tipo: 'obra' | 'almacen' } | null = null;
      let bestD = Infinity;
      for (const l of lugares) {
        if (l.latitud == null || l.longitud == null) continue;
        const d = UbicacionLabelService.haversine(lat, lng, l.latitud, l.longitud);
        if (d < bestD) {
          bestD = d;
          best = { nombre: l.nombre, tipo: l.tipo };
        }
      }
      if (best && bestD <= UbicacionLabelService.RADIO_M) {
        return `📍 ${best.tipo === 'obra' ? 'Proyecto' : 'Almacén'} ${best.nombre}`;
      }
    } catch {
      /* sin catálogo (offline) → seguimos al reverse/fallback */
    }

    // 2) reverse geocode corto
    try {
      const full = await this.geocoding.reverse(lat, lng);
      if (full) return `📍 ${UbicacionLabelService.acortar(full)}`;
    } catch {
      /* sin señal → fallback */
    }

    // 3) fallback
    return '📍 Capturada';
  }

  /** Primeras 3 partes de la dirección de Nominatim (calle, sector, ciudad). */
  private static acortar(display: string): string {
    return display
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
  }

  /** Distancia en metros entre dos coordenadas (Haversine). */
  private static haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
