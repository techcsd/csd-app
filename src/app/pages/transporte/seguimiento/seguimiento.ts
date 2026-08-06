import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import {
  SeguimientoService,
  ChoferSeguimiento,
  RutaActivaSeguimiento,
} from '../../../core/services/seguimiento.service';
import { estadoMeta, ESTADOS_CHOFER } from '../../../core/services/chofer-estado.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';

/* google.maps sin @types → lo tratamos como any. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type GAny = any;

/** AF27 — Seguimiento en vivo (jefe de flota / admin / tecnología).
 *  AG10 — usa Google Maps si hay API key configurada (RPC maps_api_key); si no,
 *  cae a Leaflet/OSM (sin regresión). Pins por estado + leyenda idénticos. */
@Component({
  selector: 'app-seguimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.scss',
})
export class SeguimientoPage implements AfterViewInit, OnDestroy {
  private service = inject(SeguimientoService);
  private location = inject(Location);
  private router = inject(Router);
  private ctx = inject(UserContextService);
  private mapsLoader = inject(GoogleMapsLoaderService);

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly DEFAULT = { lat: 18.4861, lng: -69.9312 }; // Santo Domingo

  // Leaflet (fallback)
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  // Google Maps (primario si hay key)
  private g: GAny = null;
  private gmap: GAny = null;
  private gmarkers = new Map<string, GAny>();
  private ginfo: GAny = null;
  private useGoogle = false;
  private centrado = false;

  loading = signal(true);
  choferes = signal<ChoferSeguimiento[]>([]);
  rutasActivas = signal<RutaActivaSeguimiento[]>([]);
  autorizado = signal(true);

  readonly metaOf = estadoMeta;
  // AG10 — leyenda del mapa (mismos colores/estados que la web). Colapsable.
  readonly estados = ESTADOS_CHOFER;
  leyendaAbierta = signal(false);
  toggleLeyenda(): void {
    this.leyendaAbierta.update((v) => !v);
  }

  /** Choferes con posición conocida (para el mapa). */
  conPosicion = computed(() => this.choferes().filter((c) => c.lat != null && c.lng != null));

  constructor() {
    if (!this.ctx.esFlotaElevado()) {
      this.autorizado.set(false);
    }
  }

  ngAfterViewInit(): void {
    if (!this.autorizado()) {
      this.loading.set(false);
      return;
    }
    void this.initMapa();
  }

  private async initMapa(): Promise<void> {
    const gmaps = await this.mapsLoader.load();
    if (gmaps) {
      this.g = gmaps;
      this.useGoogle = true;
      this.gmap = new this.g.Map(this.mapEl().nativeElement, {
        center: this.DEFAULT,
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      this.ginfo = new this.g.InfoWindow();
    } else {
      this.initLeaflet();
    }
    void this.cargar();
    // AF27 — realtime: al cambiar una posición, recarga (throttle simple por evento).
    this.service.suscribir(() => void this.cargar());
  }

  private initLeaflet(): void {
    this.map = L.map(this.mapEl().nativeElement, {
      center: [this.DEFAULT.lat, this.DEFAULT.lng],
      zoom: 11,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);
    requestAnimationFrame(() => this.map?.invalidateSize());
    setTimeout(() => this.map?.invalidateSize(), 320);
    setTimeout(() => this.map?.invalidateSize(), 700);
  }

  ngOnDestroy(): void {
    this.service.desuscribir();
    this.map?.remove();
    this.map = null;
    for (const m of this.gmarkers.values()) m.setMap?.(null);
    this.gmarkers.clear();
    this.gmap = null;
  }

  async cargar(): Promise<void> {
    try {
      const [chof, rutas] = await Promise.all([
        this.service.choferes(),
        this.service.rutasActivas().catch(() => []),
      ]);
      this.choferes.set(chof);
      this.rutasActivas.set(rutas);
      if (this.useGoogle) this.pintarGoogle();
      else this.pintarLeaflet();
    } finally {
      this.loading.set(false);
    }
  }

  // ── Google Maps ────────────────────────────────────────────────────────────
  private pintarGoogle(): void {
    if (!this.gmap) return;
    const vistos = new Set<string>();
    const bounds = new this.g.LatLngBounds();
    let n = 0;
    for (const c of this.conPosicion()) {
      vistos.add(c.usuario_id);
      const pos = { lat: c.lat as number, lng: c.lng as number };
      bounds.extend(pos);
      n++;
      const icon = this.iconoGoogle(c);
      const existing = this.gmarkers.get(c.usuario_id);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
      } else {
        const m = new this.g.Marker({ position: pos, map: this.gmap, icon, title: c.nombre });
        m.addListener('click', () => {
          this.ginfo.setContent(`<b>${c.nombre}</b><br>${estadoMeta(c.estado).label}`);
          this.ginfo.open(this.gmap, m);
        });
        this.gmarkers.set(c.usuario_id, m);
      }
    }
    for (const [id, m] of this.gmarkers) {
      if (!vistos.has(id)) {
        m.setMap(null);
        this.gmarkers.delete(id);
      }
    }
    if (n && !this.centrado) {
      this.gmap.fitBounds(bounds, 48);
      if (n === 1) this.gmap.setZoom(15);
      this.centrado = true;
    }
  }

  private iconoGoogle(c: ChoferSeguimiento): GAny {
    return {
      path: this.g.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: estadoMeta(c.estado).tint,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    };
  }

  // ── Leaflet (fallback) ──────────────────────────────────────────────────────
  private pintarLeaflet(): void {
    if (!this.map) return;
    const vistos = new Set<string>();
    const bounds: L.LatLngTuple[] = [];
    for (const c of this.conPosicion()) {
      vistos.add(c.usuario_id);
      const latlng: L.LatLngTuple = [c.lat as number, c.lng as number];
      bounds.push(latlng);
      const icon = this.iconoLeaflet(c);
      const existing = this.markers.get(c.usuario_id);
      if (existing) {
        existing.setLatLng(latlng);
        existing.setIcon(icon);
      } else {
        const m = L.marker(latlng, { icon }).addTo(this.map);
        m.bindPopup(`<b>${c.nombre}</b><br>${estadoMeta(c.estado).label}`);
        this.markers.set(c.usuario_id, m);
      }
    }
    for (const [id, m] of this.markers) {
      if (!vistos.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
    if (bounds.length && !this.centrado) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      this.centrado = true;
    }
  }

  private iconoLeaflet(c: ChoferSeguimiento): L.DivIcon {
    const tint = estadoMeta(c.estado).tint;
    return L.divIcon({
      className: 'seg-marker',
      html: `<div class="seg-marker__pin" style="background:${tint}"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  /** Centra el mapa en un chofer al tocarlo en el panel. */
  centrarEn(c: ChoferSeguimiento): void {
    if (c.lat == null || c.lng == null) return;
    if (this.useGoogle) {
      this.gmap?.setCenter({ lat: c.lat, lng: c.lng });
      this.gmap?.setZoom(16);
      const m = this.gmarkers.get(c.usuario_id);
      if (m) {
        this.ginfo.setContent(`<b>${c.nombre}</b><br>${estadoMeta(c.estado).label}`);
        this.ginfo.open(this.gmap, m);
      }
    } else {
      this.map?.setView([c.lat, c.lng], 16);
      this.markers.get(c.usuario_id)?.openPopup();
    }
  }

  /** Ruta activa de un chofer (match por nombre — v1). */
  rutaDe(nombre: string): RutaActivaSeguimiento | null {
    return this.rutasActivas().find((r) => r.conductor_nombre === nombre) ?? null;
  }

  actualizadoHace(iso: string | null): string {
    if (!iso) return 'sin posición';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.round(min / 60)} h`;
  }

  back(): void {
    this.location.back();
  }
}
