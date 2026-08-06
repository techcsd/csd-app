import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/* Tipos mínimos de la Maps JS API (evitamos @types/google.maps). */
type GMaps = typeof globalThis & { google?: { maps?: unknown } };

/**
 * AG10 — carga la API de Google Maps JS en runtime. La key se sirve por RPC
 * (`maps_api_key`, guardada en sgc.parametros) para NO vivir en el repo (AG1). Si
 * no hay key configurada o la carga falla, resuelve `null` → el consumidor cae a
 * Leaflet (sin regresión). Carga el script una sola vez (promesa cacheada).
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private supabase = inject(SupabaseService);
  private loadPromise: Promise<unknown | null> | null = null;

  /** Devuelve `google.maps` si hay key y carga OK; `null` para usar Leaflet. */
  load(): Promise<unknown | null> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<unknown | null> {
    const w = window as GMaps;
    if (w.google?.maps) return w.google.maps;

    let key: string | null = null;
    try {
      const { data, error } = await this.supabase.client.rpc('maps_api_key');
      if (error) return null;
      key = (data as string | null) ?? null;
    } catch {
      return null; // offline / RPC no disponible → Leaflet
    }
    if (!key) return null; // sin key configurada → Leaflet

    try {
      await this.injectScript(key);
      return (window as GMaps).google?.maps ?? null;
    } catch {
      return null;
    }
  }

  private injectScript(key: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const existing = document.getElementById('gmaps-js');
      if (existing) {
        if ((window as GMaps).google?.maps) resolve();
        else existing.addEventListener('load', () => resolve(), { once: true });
        return;
      }
      const cbName = '__csdMapsInit';
      (window as unknown as Record<string, unknown>)[cbName] = () => resolve();
      const s = document.createElement('script');
      s.id = 'gmaps-js';
      s.async = true;
      s.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&callback=${cbName}&loading=async`;
      s.onerror = () => reject(new Error('google maps script failed to load'));
      document.head.appendChild(s);
    });
  }
}
