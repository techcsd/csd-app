import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { MapMatchingService } from '../../../core/services/map-matching.service';

/* google.maps sin @types → any. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type GAny = any;

/** AU7 — una parada detectada del recorrido (stay-point). */
export interface Parada {
  inicio_at: string;
  fin_at: string;
  lat: number;
  lng: number;
  minutos: number;
}

/**
 * AU5/AU7 — mapa REUTILIZABLE que pinta una trayectoria (polyline de puntos
 * [lat,lng]) + marcadores de inicio/fin + paradas. Google Maps si hay API key
 * (RPC maps_api_key), si no cae a Leaflet/OSM (mismo patrón que Seguimiento AG10).
 * Estático (no realtime): sirve para "Ver trayectoria" de una ruta y el recorrido
 * diario del chofer.
 */
@Component({
  selector: 'app-trayectoria-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="tmap" #map></div>',
  styles: [':host{display:block} .tmap{width:100%;height:100%;min-height:260px;border-radius:14px;overflow:hidden}'],
})
export class TrayectoriaMap implements AfterViewInit, OnDestroy {
  private mapsLoader = inject(GoogleMapsLoaderService);
  private mm = inject(MapMatchingService);
  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');

  /** Puntos del recorrido como tuplas [lat, lng] (formato de ruta_trayecto / recorrido_diario_de). */
  coords = input<[number, number][]>([]);
  paradas = input<Parada[]>([]);
  /** AV7 — pegar la línea a las calles (map-matching). true por defecto. */
  matchear = input<boolean>(true);

  private readonly DEFAULT = { lat: 18.4861, lng: -69.9312 };
  private ready = false;

  // Leaflet
  private map: L.Map | null = null;
  private lPolyline: L.Polyline | null = null;
  private lMarkers: L.Marker[] = [];
  // Google
  private g: GAny = null;
  private gmap: GAny = null;
  private gPolyline: GAny = null;
  private gMarkers: GAny[] = [];
  private ginfo: GAny = null;
  private useGoogle = false;

  constructor() {
    // Redibuja cuando cambien coords/paradas (una vez el mapa esté listo).
    effect(() => {
      this.coords();
      this.paradas();
      if (this.ready) this.pintar();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const gmaps = await this.mapsLoader.load();
    if (gmaps) {
      this.g = gmaps;
      this.useGoogle = true;
      this.gmap = new this.g.Map(this.mapEl().nativeElement, {
        center: this.DEFAULT,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      this.ginfo = new this.g.InfoWindow();
    } else {
      this.map = L.map(this.mapEl().nativeElement, { center: [this.DEFAULT.lat, this.DEFAULT.lng], zoom: 12 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.map);
      requestAnimationFrame(() => this.map?.invalidateSize());
      setTimeout(() => this.map?.invalidateSize(), 320);
      setTimeout(() => this.map?.invalidateSize(), 700);
    }
    this.ready = true;
    this.pintar();
  }

  ngOnDestroy(): void {
    this.clearLeaflet();
    this.map?.remove();
    this.map = null;
    this.clearGoogle();
    this.gmap = null;
  }

  private hhmm(iso: string): string {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'p.m.' : 'a.m.';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  private pintarSeq = 0;
  private async pintar(): Promise<void> {
    const raw = this.coords();
    const seq = ++this.pintarSeq;
    let pts = raw;
    // AV7 — pega la línea a las calles (cacheado server-side + en memoria). Si
    // cambian las coords mientras se resuelve, descarta este render (evita pisar).
    if (this.matchear() && raw.length >= 2) {
      pts = await this.mm.snap(raw);
      if (seq !== this.pintarSeq) return;
    }
    if (this.useGoogle) this.pintarGoogle(pts);
    else this.pintarLeaflet(pts);
  }

  // ── Google ──
  private clearGoogle(): void {
    this.gPolyline?.setMap?.(null);
    this.gPolyline = null;
    for (const m of this.gMarkers) m.setMap?.(null);
    this.gMarkers = [];
  }
  private pintarGoogle(pts: [number, number][]): void {
    if (!this.gmap) return;
    this.clearGoogle();
    if (!pts.length) return;
    const path = pts.map(([lat, lng]) => ({ lat, lng }));
    this.gPolyline = new this.g.Polyline({ path, map: this.gmap, strokeColor: '#2563eb', strokeOpacity: 0.9, strokeWeight: 4 });
    const bounds = new this.g.LatLngBounds();
    for (const p of path) bounds.extend(p);
    // Inicio / fin.
    this.gMarkers.push(this.dotGoogle(path[0], '#16a34a', 'Inicio'));
    if (path.length > 1) this.gMarkers.push(this.dotGoogle(path[path.length - 1], '#dc2626', 'Fin'));
    // Paradas.
    for (const s of this.paradas()) {
      const pos = { lat: s.lat, lng: s.lng };
      bounds.extend(pos);
      const mk = new this.g.Marker({
        position: pos, map: this.gmap, title: `Parada · ${s.minutos} min`,
        label: { text: 'P', color: '#fff', fontSize: '11px', fontWeight: '700' },
        icon: { path: this.g.SymbolPath.CIRCLE, scale: 9, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      mk.addListener('click', () => {
        this.ginfo.setContent(`<b>Parada</b><br>${this.hhmm(s.inicio_at)} → ${this.hhmm(s.fin_at)}<br>${s.minutos} min`);
        this.ginfo.open(this.gmap, mk);
      });
      this.gMarkers.push(mk);
    }
    this.gmap.fitBounds(bounds, 48);
  }
  private dotGoogle(pos: { lat: number; lng: number }, color: string, title: string): GAny {
    return new this.g.Marker({
      position: pos, map: this.gmap, title,
      icon: { path: this.g.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
  }

  // ── Leaflet ──
  private clearLeaflet(): void {
    this.lPolyline?.remove();
    this.lPolyline = null;
    for (const m of this.lMarkers) m.remove();
    this.lMarkers = [];
  }
  private pintarLeaflet(pts: [number, number][]): void {
    if (!this.map) return;
    this.clearLeaflet();
    if (!pts.length) return;
    const latlngs = pts.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
    this.lPolyline = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(this.map);
    this.lMarkers.push(this.dotLeaflet(latlngs[0], '#16a34a').addTo(this.map).bindPopup('Inicio'));
    if (latlngs.length > 1) this.lMarkers.push(this.dotLeaflet(latlngs[latlngs.length - 1], '#dc2626').addTo(this.map).bindPopup('Fin'));
    for (const s of this.paradas()) {
      const mk = this.dotLeaflet([s.lat, s.lng], '#f59e0b', 10)
        .addTo(this.map)
        .bindPopup(`<b>Parada</b><br>${this.hhmm(s.inicio_at)} → ${this.hhmm(s.fin_at)}<br>${s.minutos} min`);
      this.lMarkers.push(mk);
    }
    const bounds = this.lPolyline.getBounds();
    for (const s of this.paradas()) bounds.extend([s.lat, s.lng]);
    this.map.fitBounds(bounds, { padding: [40, 40] });
    requestAnimationFrame(() => this.map?.invalidateSize());
  }
  private dotLeaflet(pos: L.LatLngTuple, color: string, radius = 7): L.Marker {
    const icon = L.divIcon({
      className: 'tmap-dot',
      html: `<span style="display:block;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2)"></span>`,
      iconSize: [radius * 2, radius * 2],
      iconAnchor: [radius, radius],
    });
    return L.marker(pos, { icon });
  }
}
