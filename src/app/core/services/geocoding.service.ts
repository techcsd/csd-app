import { Injectable } from '@angular/core';

export interface LugarBusqueda {
  nombre: string;
  latitud: number;
  longitud: number;
}

export interface RutaEstimada {
  distanciaM: number;
  duracionSeg: number;
}

/**
 * U19 — Geocoding keyless (OpenStreetMap Nominatim), sesgado a República
 * Dominicana (countrycodes=do, idioma es). Espeja el servicio de SGC web.
 * Forma independiente del proveedor por si luego se cambia a uno pago.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

@Injectable({ providedIn: 'root' })
export class GeocodingService {
  /** Coordenadas → dirección legible. */
  async reverse(lat: number, lng: number): Promise<string> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      'accept-language': 'es',
    });
    try {
      const res = await fetch(`${NOMINATIM}/reverse?${params.toString()}`);
      if (!res.ok) return '';
      const data = (await res.json()) as { display_name?: string };
      return data.display_name ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Búsqueda de dirección/lugar → candidatos (sesgo RD). Propaga errores
   * (throttle 429 / red) para que el UI distinga "sin resultados" de "fallo";
   * acepta AbortSignal para cancelar búsquedas obsoletas (debounce en el UI).
   */
  async buscar(texto: string, signal?: AbortSignal): Promise<LugarBusqueda[]> {
    if (!texto.trim()) return [];
    const params = new URLSearchParams({
      q: texto,
      format: 'json',
      'accept-language': 'es',
      countrycodes: 'do',
      limit: '6',
      dedupe: '1',
    });
    const res = await fetch(`${NOMINATIM}/search?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`El buscador de mapas respondió ${res.status}`);
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return data.map((d) => ({ nombre: d.display_name, latitud: Number(d.lat), longitud: Number(d.lon) }));
  }

  /**
   * U23 — Ruta en carro entre dos puntos (OSRM keyless): distancia + duración
   * estimadas para mostrar el tiempo con `formatearDuracion`. Devuelve null si
   * falla (offline o sin ruta) — la duración es una estimación, no bloquea.
   */
  async ruta(
    origen: { lat: number; lng: number },
    destino: { lat: number; lng: number },
  ): Promise<RutaEstimada | null> {
    const coords = `${origen.lng},${origen.lat};${destino.lng},${destino.lat}`;
    try {
      const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=false`);
      if (!res.ok) return null;
      const data = (await res.json()) as { routes?: { distance: number; duration: number }[] };
      const r = data.routes?.[0];
      if (!r) return null;
      return { distanciaM: r.distance, duracionSeg: r.duration };
    } catch {
      return null;
    }
  }
}
