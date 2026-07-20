import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { LocationPicker, UbicacionSeleccionada } from '../../../shared/ui/location-picker/location-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { ConducesService, LugarDestino } from '../../../core/services/conduces.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { GeocodingService } from '../../../core/services/geocoding.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { formatearDuracion } from '../../../core/util/duracion';

type DestinoModo = 'lugar' | 'mapa';

/**
 * Crear ruta desde el móvil (R7). Espeja la creación de rutas de la web SGC
 * (vehículo + origen + destino [obra o libre] + fecha + km/notas opcionales),
 * simplificada para campo. Offline-first vía outbox (crear_ruta_app idempotente).
 */
@Component({
  selector: 'app-crear-ruta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectList, OptionButton, Skeleton, LocationPicker, ConfirmDialog, VehiculoPicker],
  templateUrl: './crear-ruta.html',
  styleUrl: './crear-ruta.scss',
})
export class CrearRutaPage implements OnDestroy {
  private conduces = inject(ConducesService);
  private geo = inject(GeocodingService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private permissions = inject(PermissionsService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  fmtDur = formatearDuracion; // U23 — para el template

  loading = signal(true);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false); // U4 — confirmar descarte si hay datos

  lugares = signal<LugarDestino[]>([]);

  vehiculoId = signal('');
  vehiculoLabel = signal(''); // B1 — placa/modelo del vehículo elegido del pool
  origen = signal('');
  usandoGps = signal(false); // U21 — origen fijado por ubicación/mapa
  origenMapa = signal(false); // muestra el picker de origen
  origenLugarId = signal(''); // U22 — origen por obra/almacén
  origenLugar = signal(false); // muestra el selector de obra/almacén de origen
  destinoModo = signal<DestinoModo>('lugar');
  destinoLugarId = signal('');
  destinoMapaTexto = signal('');
  destinoMapaCoords = signal<{ lat: number; lng: number } | null>(null);
  km = signal<number | null>(null);
  notas = signal('');

  // U23 — duración estimada (min) calculada por OSRM cuando hay coords de ambos extremos.
  duracionMin = signal<number | null>(null);
  calculandoRuta = signal(false);

  private gps: { lat: number; lng: number } | null = null;

  // U22 — obras + almacenes (con ícono por tipo) para los selectores de origen/destino.
  lugarOpts = computed<SelectOption[]>(() =>
    this.lugares().map((l) => ({
      id: l.id,
      label: `${l.tipo === 'obra' ? '🏗' : '🏬'} ${l.nombre}`,
    })),
  );

  selectedLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.destinoLugarId()) ?? null,
  );

  selectedOrigenLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.origenLugarId()) ?? null,
  );

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.load();
    void this.captureGps();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // B1 — el vehículo se elige del pool (VehiculoPicker); aquí solo cargamos
      // los lugares (obras/almacenes) para origen/destino.
      this.lugares.set(await this.conduces.getLugaresDestino());
    } finally {
      this.loading.set(false);
    }
  }

  /** B1 — vehículo elegido del pool: continúa creando la ruta con ese vehículo. */
  onVehiculoElegido(v: VehiculoDisponible): void {
    this.vehiculoId.set(v.vehiculo_id);
    this.vehiculoLabel.set(`${v.placa} · ${v.marca} ${v.modelo}`.trim());
  }

  /** B1 — volver a elegir otro vehículo del pool. */
  cambiarVehiculo(): void {
    this.vehiculoId.set('');
    this.vehiculoLabel.set('');
  }

  private async captureGps(): Promise<void> {
    // Best-effort al abrir: solo pre-carga si el permiso YA está concedido (no
    // abre diálogos aquí; eso pasa cuando el usuario toca "usar mi ubicación").
    if ((await this.permissions.checkLocation()) !== 'granted') return;
    const r = await this.permissions.getPosition({ timeout: 8000 });
    this.gps = r.ok ? { lat: r.lat, lng: r.lng } : null;
  }

  /**
   * U21 — "usar mi ubicación actual" como origen, con permiso nativo y error
   * visible. Pide permiso de geolocalización y, si lo concede, fija el origen
   * con las coordenadas del GPS.
   */
  async usarMiUbicacion(): Promise<void> {
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
    if (r.ok) {
      this.gps = { lat: r.lat, lng: r.lng };
      this.origen.set('Mi ubicación actual');
      this.usandoGps.set(true);
      this.origenLugarId.set('');
      this.toast.success('Ubicación actual fijada como origen.');
      void this.recalcularRuta();
      return;
    }
    // P2 — mensajes claros por causa; ofrecer ajustes si es denegado permanente.
    if (r.reason === 'denied-permanent') {
      if (this.permissions.isNative) {
        this.toast.withAction('Ubicación bloqueada para esta app.', {
          label: 'Abrir ajustes',
          run: () => void this.permissions.openAppSettings(),
        });
      } else {
        this.toast.error('Ubicación bloqueada. Actívala en los ajustes del navegador.');
      }
    } else if (r.reason === 'denied') {
      this.toast.error('Necesito tu permiso de ubicación para fijar el origen.');
    } else if (r.reason === 'timeout') {
      this.toast.error('No se pudo obtener la señal GPS. Ve a un lugar despejado y reintenta.');
    } else {
      this.toast.error('No se pudo obtener tu ubicación. Escribe el origen o márcalo en el mapa.');
    }
  }

  onOrigenInput(v: string): void {
    this.origen.set(v);
    // Si el usuario escribe manualmente, deja de usar las coords del GPS/mapa/lugar.
    if (this.usandoGps()) {
      this.usandoGps.set(false);
      this.gps = null;
      this.origenLugarId.set('');
      void this.recalcularRuta();
    }
  }

  /** U20 — origen marcado en el mapa (pin/búsqueda/ubicación dentro del picker). */
  onOrigenUbicacion(u: UbicacionSeleccionada): void {
    this.gps = { lat: u.latitud, lng: u.longitud };
    this.origen.set(u.direccion || 'Punto en el mapa');
    this.usandoGps.set(true);
    this.origenLugarId.set('');
    void this.recalcularRuta();
  }

  /** U22 — origen por obra o almacén (usa sus coordenadas guardadas). */
  onOrigenLugar(id: string): void {
    this.origenLugarId.set(id);
    const lugar = this.selectedOrigenLugar();
    if (!lugar) return;
    this.origen.set(lugar.nombre);
    if (lugar.latitud != null && lugar.longitud != null) {
      this.gps = { lat: lugar.latitud, lng: lugar.longitud };
      this.usandoGps.set(true);
    } else {
      this.gps = null;
      this.usandoGps.set(false);
    }
    void this.recalcularRuta();
  }

  /** U20/U22 — destino marcado en el mapa. */
  onDestinoUbicacion(u: UbicacionSeleccionada): void {
    this.destinoMapaCoords.set({ lat: u.latitud, lng: u.longitud });
    this.destinoMapaTexto.set(u.direccion || 'Punto en el mapa');
    void this.recalcularRuta();
  }

  /** U22 — destino por obra o almacén. */
  onDestinoLugar(id: string): void {
    this.destinoLugarId.set(id);
    void this.recalcularRuta();
  }

  private destinoCoords(): { lat: number; lng: number } | null {
    if (this.destinoModo() === 'lugar') {
      const l = this.selectedLugar();
      return l?.latitud != null && l?.longitud != null ? { lat: l.latitud, lng: l.longitud } : null;
    }
    return this.destinoMapaCoords();
  }

  /**
   * U23 — recalcula distancia + duración estimadas (OSRM) cuando hay coords de
   * origen y destino. Autollena km si está vacío. Silencioso si falla (offline).
   */
  private async recalcularRuta(): Promise<void> {
    const o = this.gps;
    const d = this.destinoCoords();
    if (!o || !d) {
      this.duracionMin.set(null);
      return;
    }
    this.calculandoRuta.set(true);
    try {
      const r = await this.geo.ruta(o, d);
      if (r) {
        this.duracionMin.set(Math.round(r.duracionSeg / 60));
        if (this.km() == null) this.km.set(Math.round(r.distanciaM / 1000));
      } else {
        this.duracionMin.set(null);
      }
    } finally {
      this.calculandoRuta.set(false);
    }
  }

  private destinoTexto(): string {
    if (this.destinoModo() === 'lugar') {
      return this.selectedLugar()?.nombre ?? '';
    }
    return this.destinoMapaTexto().trim();
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.vehiculoId()) {
      this.toast.error('Elige el vehículo.');
      return;
    }
    if (!this.origen().trim()) {
      this.toast.error('Escribe el origen.');
      return;
    }
    if (!this.destinoTexto()) {
      this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra o almacén de destino.' : 'Marca el destino en el mapa.');
      return;
    }
    const lugar = this.destinoModo() === 'lugar' ? this.selectedLugar() : null;
    const mapaCoords = this.destinoModo() === 'mapa' ? this.destinoMapaCoords() : null;
    this.submitting.set(true);
    try {
      await this.conduces.crearRuta({
        vehiculoId: this.vehiculoId(),
        origen: this.origen().trim(),
        destino: this.destinoTexto(),
        fecha: new Date().toISOString().slice(0, 10),
        destinoProyectoId: lugar?.tipo === 'obra' ? lugar.id : null,
        kmEstimado: this.km(),
        notas: this.notas().trim() || null,
        origen_lat: this.gps?.lat ?? null,
        origen_lng: this.gps?.lng ?? null,
        destino_lat: lugar?.latitud ?? mapaCoords?.lat ?? null,
        destino_lng: lugar?.longitud ?? mapaCoords?.lng ?? null,
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la ruta. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces'], { replaceUrl: true });
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  /** U4 — ¿hay datos que se perderían al salir? */
  private tieneDatos(): boolean {
    return !!(
      this.origen().trim() ||
      this.origenLugarId() ||
      this.destinoLugarId() ||
      this.destinoMapaTexto().trim() ||
      this.km() != null ||
      this.notas().trim()
    );
  }

  back(): void {
    if (this.done()) {
      this.location.back();
      return;
    }
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.location.back();
  }

  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.location.back();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  get online(): boolean {
    return this.network.online();
  }
}
