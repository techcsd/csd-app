import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';

import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConducesService, LugarDestino } from '../../../core/services/conduces.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';

type DestinoModo = 'lugar' | 'libre';

/**
 * Crear ruta desde el móvil (R7). Espeja la creación de rutas de la web SGC
 * (vehículo + origen + destino [obra o libre] + fecha + km/notas opcionales),
 * simplificada para campo. Offline-first vía outbox (crear_ruta_app idempotente).
 */
@Component({
  selector: 'app-crear-ruta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectList, OptionButton, EmptyState, Skeleton],
  templateUrl: './crear-ruta.html',
  styleUrl: './crear-ruta.scss',
})
export class CrearRutaPage {
  private conduces = inject(ConducesService);
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  submitting = signal(false);
  done = signal(false);

  vehiculoOpts = signal<SelectOption[]>([]);
  lugares = signal<LugarDestino[]>([]);

  vehiculoId = signal('');
  origen = signal('');
  usandoGps = signal(false); // U21 — origen fijado por ubicación actual
  destinoModo = signal<DestinoModo>('lugar');
  destinoLugarId = signal('');
  destinoLibre = signal('');
  km = signal<number | null>(null);
  notas = signal('');

  private gps: { lat: number; lng: number } | null = null;

  // U22 — obras + almacenes (con ícono por tipo) para el selector de destino.
  lugarOpts = computed<SelectOption[]>(() =>
    this.lugares().map((l) => ({
      id: l.id,
      label: `${l.tipo === 'obra' ? '🏗' : '🏬'} ${l.nombre}`,
    })),
  );

  selectedLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.destinoLugarId()) ?? null,
  );

  constructor() {
    void this.load();
    void this.captureGps();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [pend, asig, lugares] = await Promise.all([
        this.vehiculos.misPendientes(),
        this.vehiculos.getMisAsignaciones(),
        this.conduces.getLugaresDestino(),
      ]);
      const opts = new Map<string, SelectOption>();
      for (const v of pend.a_cargo) opts.set(v.vehiculo_id, { id: v.vehiculo_id, label: `${v.placa} · ${v.marca} ${v.modelo}` });
      for (const v of asig) opts.set(v.vehiculo_id, { id: v.vehiculo_id, label: `${v.placa} · ${v.marca} ${v.modelo}` });
      this.vehiculoOpts.set([...opts.values()]);
      this.lugares.set(lugares);
      if (this.vehiculoOpts().length === 1) this.vehiculoId.set(this.vehiculoOpts()[0].id);
    } finally {
      this.loading.set(false);
    }
  }

  private async captureGps(): Promise<void> {
    try {
      const pos = await Geolocation.getCurrentPosition({ timeout: 8000 });
      this.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      this.gps = null;
    }
  }

  /**
   * U21 — "usar mi ubicación actual" como origen, con permiso nativo y error
   * visible. Pide permiso de geolocalización de Capacitor y, si lo concede,
   * fija el origen con las coordenadas del GPS.
   */
  async usarMiUbicacion(): Promise<void> {
    try {
      const perm = await Geolocation.requestPermissions();
      if (perm.location === 'denied') {
        this.toast.error('Permiso de ubicación denegado. Actívalo en los ajustes del teléfono.');
        return;
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      this.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.origen.set('Mi ubicación actual');
      this.usandoGps.set(true);
      this.toast.success('Ubicación actual fijada como origen.');
    } catch {
      this.toast.error('No se pudo obtener tu ubicación. Revisa el GPS y los permisos.');
    }
  }

  onOrigenInput(v: string): void {
    this.origen.set(v);
    // Si el usuario escribe manualmente, deja de usar las coords del GPS.
    if (this.usandoGps()) this.usandoGps.set(false);
  }

  private destinoTexto(): string {
    if (this.destinoModo() === 'lugar') {
      return this.selectedLugar()?.nombre ?? '';
    }
    return this.destinoLibre().trim();
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
      this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra o almacén de destino.' : 'Escribe el destino.');
      return;
    }
    const lugar = this.destinoModo() === 'lugar' ? this.selectedLugar() : null;
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
        destino_lat: lugar?.latitud ?? null,
        destino_lng: lugar?.longitud ?? null,
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

  back(): void {
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
