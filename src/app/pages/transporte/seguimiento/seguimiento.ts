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

/** AF27 — Seguimiento en vivo (jefe de flota / admin / tecnología). */
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

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  private readonly DEFAULT: L.LatLngTuple = [18.4861, -69.9312]; // Santo Domingo

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
    this.map = L.map(this.mapEl().nativeElement, { center: this.DEFAULT, zoom: 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);
    requestAnimationFrame(() => this.map?.invalidateSize());
    setTimeout(() => this.map?.invalidateSize(), 320);
    setTimeout(() => this.map?.invalidateSize(), 700);

    void this.cargar();
    // AF27 — realtime: al cambiar una posición, recarga (throttle simple por evento).
    this.service.suscribir(() => void this.cargar());
  }

  ngOnDestroy(): void {
    this.service.desuscribir();
    this.map?.remove();
    this.map = null;
  }

  async cargar(): Promise<void> {
    try {
      const [chof, rutas] = await Promise.all([
        this.service.choferes(),
        this.service.rutasActivas().catch(() => []),
      ]);
      this.choferes.set(chof);
      this.rutasActivas.set(rutas);
      this.pintarMarcadores();
    } finally {
      this.loading.set(false);
    }
  }

  private pintarMarcadores(): void {
    if (!this.map) return;
    const vistos = new Set<string>();
    const bounds: L.LatLngTuple[] = [];
    for (const c of this.conPosicion()) {
      vistos.add(c.usuario_id);
      const latlng: L.LatLngTuple = [c.lat as number, c.lng as number];
      bounds.push(latlng);
      const icon = this.icono(c);
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
    // Quita marcadores de choferes que ya no tienen posición.
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
  private centrado = false;

  private icono(c: ChoferSeguimiento): L.DivIcon {
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
    this.map?.setView([c.lat, c.lng], 16);
    this.markers.get(c.usuario_id)?.openPopup();
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
