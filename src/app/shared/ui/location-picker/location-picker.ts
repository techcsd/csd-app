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

export interface UbicacionSeleccionada {
  latitud: number;
  longitud: number;
  direccion: string;
}

/**
 * U18/U19/U20/U21 — Selector de ubicación con mapa (Leaflet + OSM). Pin por
 * toque, búsqueda con sesgo RD, y "usar mi ubicación actual" (Geolocation nativo
 * de Capacitor). Aislado del resto de la app: emite {lat,lng,direccion}. Espeja
 * el picker de SGC web; adaptado a móvil (WebView Android + botones grandes).
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

  latitud = input<number | null>(null);
  longitud = input<number | null>(null);
  ubicacionChange = output<UbicacionSeleccionada>();

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;

  // Vista por defecto: Santo Domingo, RD.
  private readonly DEFAULT: L.LatLngTuple = [18.4861, -69.9312];

  direccion = signal('');
  buscando = signal(false);
  resultados = signal<LugarBusqueda[]>([]);
  busquedaError = signal('');
  ubicando = signal(false);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAbort: AbortController | null = null;

  constructor() {
    // Reaccionar a cambios de los inputs lat/lng después de init.
    effect(() => {
      const lat = this.latitud();
      const lng = this.longitud();
      if (this.map && lat != null && lng != null) {
        this.map.setView([lat, lng], 15);
        void this.setMarker(lat, lng, false);
      }
    });
  }

  ngAfterViewInit() {
    const lat = this.latitud();
    const lng = this.longitud();
    const center: L.LatLngTuple = lat != null && lng != null ? [lat, lng] : this.DEFAULT;

    this.map = L.map(this.mapEl().nativeElement, { center, zoom: lat != null ? 15 : 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    if (lat != null && lng != null) this.setMarker(lat, lng, false);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      void this.setMarker(e.latlng.lat, e.latlng.lng, true);
    });

    // U18 — en el WebView de Android los tiles salen grises si no se recalcula
    // el tamaño tras el layout. Varios nudges cubren el timing.
    requestAnimationFrame(() => this.map?.invalidateSize());
    setTimeout(() => this.map?.invalidateSize(), 320);
    setTimeout(() => this.map?.invalidateSize(), 700);
  }

  /** Fuerza recálculo del tamaño (llamar al mostrar el contenedor). */
  refrescar() {
    this.map?.invalidateSize();
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.map?.remove();
    this.map = null;
  }

  private customIcon(): L.DivIcon {
    // DivIcon evita los assets de imagen de Leaflet (se rompen con el bundler).
    return L.divIcon({
      className: 'lp-marker',
      html: '<div class="lp-marker__pin"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    });
  }

  private async setMarker(lat: number, lng: number, emitAndGeocode: boolean) {
    if (!this.map) return;
    if (this.marker) this.marker.setLatLng([lat, lng]);
    else this.marker = L.marker([lat, lng], { icon: this.customIcon() }).addTo(this.map);
    if (emitAndGeocode) {
      const dir = await this.geocoding.reverse(lat, lng);
      this.direccion.set(dir);
      this.ubicacionChange.emit({ latitud: lat, longitud: lng, direccion: dir });
    }
  }

  /** U21 — usar mi ubicación actual (permiso nativo + error visible). */
  async usarMiUbicacion() {
    if (this.ubicando()) return;
    this.ubicando.set(true);
    try {
      const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
      if (r.ok) {
        this.map?.setView([r.lat, r.lng], 16);
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
  onBuscar(texto: string) {
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

  private async ejecutarBusqueda(q: string) {
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

  seleccionarResultado(r: LugarBusqueda) {
    this.resultados.set([]);
    this.busquedaError.set('');
    this.direccion.set(r.nombre);
    this.map?.setView([r.latitud, r.longitud], 16);
    void this.setMarker(r.latitud, r.longitud, false);
    this.ubicacionChange.emit({ latitud: r.latitud, longitud: r.longitud, direccion: r.nombre });
  }
}
