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
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import {
  SeguimientoService,
  ChoferSeguimiento,
  RutaActivaSeguimiento,
  UltimaPosRealtime,
} from '../../../core/services/seguimiento.service';
import { estadoMeta, ESTADOS_CHOFER } from '../../../core/services/chofer-estado.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { MapMatchingService } from '../../../core/services/map-matching.service';
import { vehiculoIdentidad } from '../../../core/models/transporte.model';

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
  private route = inject(ActivatedRoute);
  private ctx = inject(UserContextService);
  private mm = inject(MapMatchingService);

  // AT10 — al llegar desde "Vehículos en uso" (?usuario), centra ese chofer 1 vez.
  private focoUsuarioId = this.route.snapshot.queryParamMap.get('usuario');
  private focoAplicado = false;
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
  // AJ14/AV1 — trazado en vivo POR CHOFER, sólo del seleccionado (color propio).
  private gPolylines = new Map<string, GAny>();
  private lPolylines = new Map<string, L.Polyline>();
  // QA-11: debounce de recargas por realtime + memo del set de rutas activas.
  private cargarTimer: ReturnType<typeof setTimeout> | null = null;
  // AV1 — el trazo pintado (para no re-consultar el mismo chofer sin cambios).
  private breadcrumbId: string | null = null;
  // AV1 — marcador seleccionado: su trayectoria se dibuja; los demás sólo marcador.
  selectedId = signal<string | null>(null);
  // AV1 — un marcador se considera "sin señal" si su último punto tiene >N min.
  private readonly STALE_MIN = 10;
  // AV1 — tick para refrescar el texto "última señal hace X" cada minuto.
  now = signal(Date.now());
  private nowTimer: ReturnType<typeof setInterval> | null = null;

  loading = signal(true);
  choferes = signal<ChoferSeguimiento[]>([]);
  rutasActivas = signal<RutaActivaSeguimiento[]>([]);
  autorizado = signal(true);

  readonly metaOf = estadoMeta;
  readonly ident = vehiculoIdentidad; // AT9
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
    // AV1: realtime → mueve el marcador de ESE chofer al instante (dot en
    // movimiento), y además programa una recarga DEBOUNCED (trailing ~2.5s) para
    // reconciliar roster/estado/trazo sin recargar todo por cada punto.
    this.service.suscribir((row) => this.onRealtime(row));
    // AV1 — refresca el "hace X min" y la marca de staleness cada minuto.
    this.nowTimer = setInterval(() => this.now.set(Date.now()), 60000);
  }

  /** QA-11 — coalesce ráfagas de eventos realtime en una sola recarga. */
  private cargarDebounced(): void {
    if (this.cargarTimer) clearTimeout(this.cargarTimer);
    this.cargarTimer = setTimeout(() => {
      this.cargarTimer = null;
      void this.cargar();
    }, 2500);
  }

  /**
   * AV1 — llega una posición nueva por realtime: mueve ESE marcador al instante
   * (interpolado) y actualiza la fila en memoria (para "hace X" y staleness). Si el
   * chofer no está en la lista todavía (nuevo), recarga. Siempre reconcilia con una
   * recarga debounced (estado/roster viven en otra fuente).
   */
  private onRealtime(row: UltimaPosRealtime | null): void {
    if (!row) {
      this.cargarDebounced();
      return;
    }
    const idx = this.choferes().findIndex((c) => c.usuario_id === row.usuario_id);
    if (idx < 0) {
      // Chofer nuevo con posición → recarga para traerlo con su estado.
      this.cargarDebounced();
      return;
    }
    // Actualiza la fila en memoria (inmutable) para el panel y la staleness.
    this.choferes.update((list) =>
      list.map((c) =>
        c.usuario_id === row.usuario_id
          ? { ...c, lat: row.lat, lng: row.lng, capturado_en: row.capturado_en }
          : c,
      ),
    );
    // Mueve el marcador (suave) sin recargar todo.
    this.moverMarcador(row.usuario_id, row.lat, row.lng);
    // Si es el chofer seleccionado, extiende su trayectoria.
    if (this.selectedId() === row.usuario_id) {
      this.breadcrumbId = null; // fuerza refetch del trazo del seleccionado
      void this.pintarBreadcrumbSeleccionado();
    }
    // Reconciliar estado/roster de fondo (coalescido).
    this.cargarDebounced();
  }

  /** AV1 — interpola el marcador de un chofer de su posición actual a la nueva. */
  private moverMarcador(usuarioId: string, lat: number, lng: number): void {
    if (this.useGoogle) {
      const m = this.gmarkers.get(usuarioId);
      if (!m) return;
      const from = m.getPosition?.();
      const fLat = from?.lat?.() ?? lat;
      const fLng = from?.lng?.() ?? lng;
      this.tween(fLat, fLng, lat, lng, (la, ln) => m.setPosition({ lat: la, lng: ln }));
    } else {
      const m = this.markers.get(usuarioId);
      if (!m) return;
      const from = m.getLatLng();
      this.tween(from.lat, from.lng, lat, lng, (la, ln) => m.setLatLng([la, ln]));
    }
  }

  /** AV1 — tween lineal breve (~800ms) para que el punto se vea moverse. */
  private tween(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    apply: (lat: number, lng: number) => void,
  ): void {
    // Salto grande (>2km) o sin cambio → sin animación.
    const d = Math.hypot(toLat - fromLat, toLng - fromLng);
    if (d === 0 || d > 0.02) {
      apply(toLat, toLng);
      return;
    }
    const dur = 800;
    const start = performance.now();
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / dur);
      apply(fromLat + (toLat - fromLat) * k, fromLng + (toLng - fromLng) * k);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** AV1 — ¿el último punto de este chofer es viejo (sin señal)? */
  esStale(iso: string | null): boolean {
    if (!iso) return true;
    return this.now() - new Date(iso).getTime() > this.STALE_MIN * 60000;
  }

  /** AV1 — color estable propio de cada chofer (para su trayectoria). */
  colorDe(usuarioId: string): string {
    let h = 0;
    for (let i = 0; i < usuarioId.length; i++) h = (h * 31 + usuarioId.charCodeAt(i)) % 360;
    return `hsl(${h}, 72%, 45%)`;
  }

  /** AV1 — selecciona/deselecciona un chofer: dibuja/oculta su trayectoria. */
  seleccionar(c: ChoferSeguimiento): void {
    const nuevo = this.selectedId() === c.usuario_id ? null : c.usuario_id;
    this.selectedId.set(nuevo);
    this.breadcrumbId = null;
    // Repinta los marcadores para reflejar el anillo del seleccionado al instante.
    if (this.useGoogle) this.pintarGoogle();
    else this.pintarLeaflet();
    void this.pintarBreadcrumbSeleccionado();
    if (nuevo) this.centrarEn(c);
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
    if (this.cargarTimer) clearTimeout(this.cargarTimer); // QA-11
    if (this.nowTimer) clearInterval(this.nowTimer); // AV1
    for (const pl of this.lPolylines.values()) pl.remove();
    this.lPolylines.clear();
    this.map?.remove();
    this.map = null;
    for (const m of this.gmarkers.values()) m.setMap?.(null);
    this.gmarkers.clear();
    for (const pl of this.gPolylines.values()) pl.setMap?.(null);
    this.gPolylines.clear();
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
      void this.pintarBreadcrumbSeleccionado(); // AV1 — solo el chofer seleccionado
      // AT10 — enfoca (una vez) al chofer que llegó por ?usuario, si tiene posición.
      if (this.focoUsuarioId && !this.focoAplicado) {
        const c = chof.find((x) => x.usuario_id === this.focoUsuarioId);
        if (c && c.lat != null && c.lng != null) {
          this.focoAplicado = true;
          this.centrarEn(c);
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** AV1 — SÓLO el chofer seleccionado deja línea (color propio); se oculta al
   *  deseleccionar. Se acabaron las líneas rectas superpuestas de todos a la vez.
   *  La línea sigue los puntos crudos; el map-matching (calles) es un paso aparte
   *  cuando la edge `snap-to-roads` esté decidida/implementada (⏸ PROMPT-23 AV7). */
  private async pintarBreadcrumbSeleccionado(): Promise<void> {
    const sel = this.selectedId();
    // Ninguno seleccionado → limpia todos los trazos.
    if (!sel) {
      this.limpiarTrazos();
      this.breadcrumbId = null;
      return;
    }
    // Ya está pintado ese mismo chofer → nada que hacer.
    if (this.breadcrumbId === sel && (this.gPolylines.has(sel) || this.lPolylines.has(sel))) return;
    this.limpiarTrazos();
    const crudos = await this.service.choferBreadcrumb(sel);
    // La selección pudo cambiar mientras se resolvía el fetch.
    if (this.selectedId() !== sel) return;
    this.breadcrumbId = sel;
    if (crudos.length < 2) return;
    // AV7 — pega la línea a las calles (map-matching, cacheado). Degrada a crudos.
    const coords = await this.mm.snap(crudos);
    if (this.selectedId() !== sel) return;
    const color = this.colorDe(sel);
    if (this.useGoogle && this.gmap) {
      const path = coords.map(([lat, lng]) => ({ lat, lng }));
      const pl = new this.g.Polyline({ path, map: this.gmap, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 4 });
      this.gPolylines.set(sel, pl);
    } else if (this.map) {
      const latlngs = coords.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
      this.lPolylines.set(sel, L.polyline(latlngs, { color, weight: 4, opacity: 0.9 }).addTo(this.map));
    }
  }

  private limpiarTrazos(): void {
    for (const [, pl] of this.gPolylines) pl.setMap?.(null);
    this.gPolylines.clear();
    for (const [, pl] of this.lPolylines) pl.remove();
    this.lPolylines.clear();
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
        // AV1 — tocar el marcador selecciona el chofer (dibuja su trayectoria).
        m.addListener('click', () => this.seleccionar(c));
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
    const stale = this.esStale(c.capturado_en); // AV1 — sin señal reciente
    const sel = this.selectedId() === c.usuario_id;
    return {
      path: this.g.SymbolPath.CIRCLE,
      scale: sel ? 12 : 9,
      fillColor: stale ? '#9ca3af' : estadoMeta(c.estado).tint, // gris si sin señal
      fillOpacity: stale ? 0.65 : 1,
      strokeColor: sel ? this.colorDe(c.usuario_id) : '#ffffff',
      strokeWeight: sel ? 4 : 2,
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
        // AV1 — tocar el marcador selecciona el chofer (dibuja su trayectoria).
        m.on('click', () => this.seleccionar(c));
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
    const stale = this.esStale(c.capturado_en); // AV1
    const sel = this.selectedId() === c.usuario_id;
    const tint = stale ? '#9ca3af' : estadoMeta(c.estado).tint;
    const ring = sel ? `box-shadow:0 0 0 3px ${this.colorDe(c.usuario_id)};` : '';
    const size = sel ? 30 : 24;
    return L.divIcon({
      className: 'seg-marker' + (stale ? ' seg-marker--stale' : ''),
      html: `<div class="seg-marker__pin" style="background:${tint};opacity:${stale ? 0.65 : 1};${ring}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
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
    // AV1 — usa el tick `now()` para refrescar el texto cada minuto.
    const min = Math.round((this.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `sin señal hace ${Math.round(h / 24)} d`;
  }

  back(): void {
    this.location.back();
  }
}
