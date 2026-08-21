import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  effect,
  viewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import * as L from 'leaflet';
import { GeocodingService, LugarBusqueda } from '../../../core/services/geocoding.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { ToastService } from '../../../core/services/toast.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';

/* google.maps sin @types → lo tratamos como any (igual que seguimiento). */
/* eslint-disable @typescript-eslint/no-explicit-any */
type GAny = any;

export interface UbicacionSeleccionada {
  latitud: number;
  longitud: number;
  direccion: string;
}

/**
 * U18/U19/U20/U21 — Selector de ubicación con mapa. **AO — usa Google Maps** (regla:
 * Google en TODO mapa de la app) vía `GoogleMapsLoaderService`; si no hay key/carga
 * falla (offline), cae a Leaflet/OSM como red de seguridad (sin quedarse sin mapa).
 * Pin por toque/arrastre, búsqueda con sesgo RD y "usar mi ubicación actual"
 * (Geolocation nativo). Aislado del resto de la app: emite {lat,lng,direccion}.
 */
@Component({
  selector: 'app-location-picker',
  standalone: true,
  imports: [],
  templateUrl: './location-picker.html',
  styleUrl: './location-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationPicker implements AfterViewInit, OnDestroy {
  private geocoding = inject(GeocodingService);
  private permissions = inject(PermissionsService);
  private toast = inject(ToastService);
  private mapsLoader = inject(GoogleMapsLoaderService);

  latitud = input<number | null>(null);
  longitud = input<number | null>(null);
  ubicacionChange = output<UbicacionSeleccionada>();

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');

  // Google Maps (primario si hay key).
  private g: GAny = null;
  private gmap: GAny = null;
  private gmarker: GAny = null;
  private useGoogle = false;

  // Leaflet (fallback offline / sin key).
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;

  private ready = false;

  // Vista por defecto: Santo Domingo, RD.
  private readonly DEFAULT = { lat: 18.4861, lng: -69.9312 };

  direccion = signal('');
  buscando = signal(false);
  resultados = signal<LugarBusqueda[]>([]);
  busquedaError = signal('');
  ubicando = signal(false);

  // AT13 — pegar link de Google Maps / coordenadas.
  linkTexto = signal('');
  resolviendo = signal(false);
  linkError = signal('');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAbort: AbortController | null = null;

  constructor() {
    // Reaccionar a cambios de los inputs lat/lng después de init.
    effect(() => {
      const lat = this.latitud();
      const lng = this.longitud();
      if (this.ready && lat != null && lng != null) {
        this.centrar(lat, lng, 15);
        void this.setMarker(lat, lng, false);
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const lat = this.latitud();
    const lng = this.longitud();
    const center = lat != null && lng != null ? { lat, lng } : this.DEFAULT;
    const zoom = lat != null ? 15 : 11;

    const gmaps = await this.mapsLoader.load();
    if (gmaps) {
      this.g = gmaps;
      this.useGoogle = true;
      this.gmap = new this.g.Map(this.mapEl().nativeElement, {
        center,
        zoom,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      // Pin por toque en el mapa.
      this.gmap.addListener('click', (e: GAny) => {
        void this.setMarker(e.latLng.lat(), e.latLng.lng(), true);
      });
    } else {
      this.initLeaflet(center, zoom);
    }

    this.ready = true;
    if (lat != null && lng != null) void this.setMarker(lat, lng, false);

    // WebView Android: el mapa sale gris si no se recalcula el tamaño tras el layout.
    this.nudge();
    setTimeout(() => this.nudge(), 320);
    setTimeout(() => this.nudge(), 700);
  }

  private initLeaflet(center: { lat: number; lng: number }, zoom: number): void {
    this.map = L.map(this.mapEl().nativeElement, { center: [center.lat, center.lng], zoom });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      void this.setMarker(e.latlng.lat, e.latlng.lng, true);
    });
  }

  /** Fuerza recálculo del tamaño (llamar al mostrar el contenedor). */
  refrescar(): void {
    this.nudge();
  }

  /** Recalcula el tamaño del mapa (Google o Leaflet) tras cambios de layout. */
  private nudge(): void {
    if (this.useGoogle) {
      if (this.gmap && this.g) {
        this.g.event.trigger(this.gmap, 'resize');
        const c = this.gmap.getCenter?.();
        if (c) this.gmap.setCenter(c);
      }
    } else {
      this.map?.invalidateSize();
    }
  }

  /** Centra el mapa activo en (lat,lng) con el zoom dado. */
  private centrar(lat: number, lng: number, zoom: number): void {
    if (this.useGoogle) {
      this.gmap?.setCenter({ lat, lng });
      this.gmap?.setZoom(zoom);
    } else {
      this.map?.setView([lat, lng], zoom);
    }
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.map?.remove();
    this.map = null;
    this.gmarker?.setMap?.(null);
    this.gmarker = null;
    this.gmap = null;
  }

  private leafletIcon(): L.DivIcon {
    // DivIcon evita los assets de imagen de Leaflet (se rompen con el bundler).
    return L.divIcon({
      className: 'lp-marker',
      html: '<div class="lp-marker__pin"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    });
  }

  private async setMarker(lat: number, lng: number, emitAndGeocode: boolean): Promise<void> {
    if (this.useGoogle) {
      if (!this.gmap) return;
      if (this.gmarker) {
        this.gmarker.setPosition({ lat, lng });
      } else {
        this.gmarker = new this.g.Marker({ position: { lat, lng }, map: this.gmap, draggable: true });
        // Arrastrar el pin también fija/geocodifica el punto.
        this.gmarker.addListener('dragend', (e: GAny) => {
          void this.setMarker(e.latLng.lat(), e.latLng.lng(), true);
        });
      }
    } else {
      if (!this.map) return;
      if (this.marker) this.marker.setLatLng([lat, lng]);
      else this.marker = L.marker([lat, lng], { icon: this.leafletIcon() }).addTo(this.map);
    }
    if (emitAndGeocode) {
      const dir = await this.geocoding.reverse(lat, lng);
      this.direccion.set(dir);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion: dir });
    }
  }

  /**
   * AT13 — resuelve el link de Google Maps o las coordenadas pegadas, centra el
   * mapa y fija el pin. La edge maneja links cortos, ?q=lat,lng, @lat,lng y coords
   * a secas, así que no filtramos en cliente: resolvemos lo que se pegue.
   */
  async fijarLink(): Promise<void> {
    const entrada = this.linkTexto().trim();
    if (!entrada || this.resolviendo()) return;
    this.resolviendo.set(true);
    this.linkError.set('');
    try {
      const { lat, lng, direccion } = await this.geocoding.resolverLink(entrada);
      this.centrar(lat, lng, 16);
      await this.setMarker(lat, lng, false);
      this.direccion.set(direccion);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion });
      this.linkTexto.set('');
      this.busquedaError.set('');
    } catch (e) {
      this.linkError.set(
        (e as Error)?.message || 'No se pudo resolver la ubicación. Revisa el link o las coordenadas.',
      );
    } finally {
      this.resolviendo.set(false);
    }
  }

  /** U21 — usar mi ubicación actual (permiso nativo + error visible). */
  async usarMiUbicacion(): Promise<void> {
    if (this.ubicando()) return;
    this.ubicando.set(true);
    try {
      const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
      if (r.ok) {
        this.centrar(r.lat, r.lng, 16);
        await this.setMarker(r.lat, r.lng, true);
        this.busquedaError.set('');
        return;
      }
      // P2 — mensajes claros por causa; ofrecer ajustes si es denegado permanente.
      if (r.reason === 'denied-permanent') {
        this.busquedaError.set('Ubicación bloqueada. Actívala en los ajustes de la app.');
        if (this.permissions.isNative) {
          this.toast.withAction('Ubicación bloqueada para esta app.', {
            label: 'Abrir ajustes',
            run: () => void this.permissions.openAppSettings(),
          });
        }
      } else if (r.reason === 'denied') {
        this.busquedaError.set('Necesito tu permiso de ubicación para usar tu posición.');
      } else if (r.reason === 'timeout') {
        this.busquedaError.set('No se pudo obtener la señal GPS. Ve a un lugar despejado y reintenta.');
      } else {
        this.busquedaError.set('No se pudo obtener tu ubicación. Marca el punto en el mapa.');
      }
    } finally {
      this.ubicando.set(false);
    }
  }

  /** U19 — debounce por tecleo (Nominatim ~1 req/s) + cancelar obsoletas. */
  onBuscar(texto: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.busquedaError.set('');
    const q = texto.trim();
    if (!q) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }
    this.buscando.set(true);
    this.searchTimer = setTimeout(() => void this.ejecutarBusqueda(q), 400);
  }

  private async ejecutarBusqueda(q: string): Promise<void> {
    this.searchAbort?.abort();
    const ac = new AbortController();
    this.searchAbort = ac;
    try {
      const res = await this.geocoding.buscar(q, ac.signal);
      if (ac.signal.aborted) return;
      this.resultados.set(res);
      if (res.length === 0) {
        this.busquedaError.set('Sin resultados. Prueba otro nombre o marca el punto en el mapa.');
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      this.resultados.set([]);
      this.busquedaError.set('No se pudo buscar ahora. Reintenta o marca el punto en el mapa.');
    } finally {
      if (!ac.signal.aborted) this.buscando.set(false);
    }
  }

  seleccionarResultado(r: LugarBusqueda): void {
    this.resultados.set([]);
    this.busquedaError.set('');
    this.direccion.set(r.nombre);
    this.centrar(r.latitud, r.longitud, 16);
    void this.setMarker(r.latitud, r.longitud, false);
    this.ubicacionChange.emit({ latitud: r.latitud, longitud: r.longitud, direccion: r.nombre });
  }
}
