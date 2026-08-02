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

/** Componentes de dirección de Nominatim (parcial, solo lo que usamos). */
interface NominatimAddress {
  road?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  residential?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
}
interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: NominatimAddress;
  namedetails?: { name?: string };
}

function ciudadDe(a?: NominatimAddress): string {
  return a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? a?.county ?? '';
}
function sectorDe(a?: NominatimAddress): string {
  return a?.neighbourhood ?? a?.suburb ?? a?.quarter ?? a?.residential ?? a?.city_district ?? '';
}
function calleDe(a?: NominatimAddress): string {
  return [a?.road, a?.house_number].filter(Boolean).join(' ');
}

/**
 * Etiqueta CORTA y legible: nombre del establecimiento (si es un lugar) o la
 * calle, + el sector y la ciudad. Se quitan país ("República Dominicana"),
 * código postal y provincia (obvios/redundantes en campo). AE — el chofer
 * necesita algo escaneable, no la dirección completa de Nominatim.
 */
function etiquetaCorta(display: string, a?: NominatimAddress, name?: string): string {
  const principal = (name && name.trim()) || calleDe(a) || (display.split(',')[0] ?? '').trim();
  const partes = [principal, sectorDe(a), ciudadDe(a)].filter((p): p is string => !!p && !!p.trim());
  const uniq = partes.filter((p, i) => partes.indexOf(p) === i); // sin duplicados consecutivos
  const corta = uniq.join(', ');
  // Fallback si Nominatim no trajo address: recorta el país del display_name.
  return corta || display.replace(/,?\s*(República Dominicana|Dominican Republic)\s*$/i, '').trim() || display;
}

@Injectable({ providedIn: 'root' })
export class GeocodingService {
  /** Coordenadas → dirección legible y CORTA (sin país/código postal). */
  async reverse(lat: number, lng: number): Promise<string> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      'accept-language': 'es',
      addressdetails: '1',
      zoom: '18',
    });
    try {
      const res = await fetch(`${NOMINATIM}/reverse?${params.toString()}`);
      if (!res.ok) return '';
      const data = (await res.json()) as NominatimResult;
      return etiquetaCorta(data.display_name ?? '', data.address, data.name);
    } catch {
      return '';
    }
  }

  /**
   * Búsqueda de dirección/lugar → candidatos (sesgo RD). Devuelve también
   * ESTABLECIMIENTOS (talleres, ferreterías, etc.) por su nombre, con una
   * etiqueta corta. Propaga errores (429/red) para que el UI distinga "sin
   * resultados" de "fallo"; acepta AbortSignal para cancelar búsquedas obsoletas.
   */
  async buscar(texto: string, signal?: AbortSignal): Promise<LugarBusqueda[]> {
    if (!texto.trim()) return [];
    const params = new URLSearchParams({
      q: texto,
      format: 'json',
      'accept-language': 'es',
      countrycodes: 'do',
      limit: '10',
      dedupe: '1',
      addressdetails: '1',
      namedetails: '1',
    });
    const res = await fetch(`${NOMINATIM}/search?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`El buscador de mapas respondió ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return []; // Nominatim a veces devuelve un objeto de error con 200
    return (data as NominatimResult[]).map((d) => ({
      nombre: etiquetaCorta(d.display_name, d.address, d.namedetails?.name ?? d.name),
      latitud: Number(d.lat),
      longitud: Number(d.lon),
    }));
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
