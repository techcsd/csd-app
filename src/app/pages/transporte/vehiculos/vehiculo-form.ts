import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculosService, VehiculoEditable } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedPhoto } from '../../../core/services/camera.service';

const ESTADOS = [
  { v: 'activo', label: 'Activo' },
  { v: 'no_disponible', label: 'No disponible' },
  { v: 'baja', label: 'Baja' },
];

/** Alta/edición de vehículo (admin; RLS vehiculos:write = is_admin). */
@Component({
  selector: 'app-vehiculo-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, PhotoSlot, WizardFooter, Skeleton],
  templateUrl: './vehiculo-form.html',
  styleUrl: './vehiculo-form.scss',
})
export class VehiculoFormPage {
  private vehiculos = inject(VehiculosService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  readonly estados = ESTADOS;

  vehiculoId = signal<string>('');
  esEdicion = computed(() => !!this.vehiculoId());
  loading = signal(false);
  submitting = signal(false);

  placa = signal('');
  marca = signal('');
  modelo = signal('');
  anio = signal<number | null>(null);
  tipo = signal('');
  estado = signal('activo');
  kilometraje = signal<number | null>(null);
  vencMatricula = signal('');
  vencSeguro = signal('');
  kmUltMant = signal<number | null>(null);
  intervaloMant = signal<number | null>(5000);
  notas = signal('');
  foto = signal<CapturedPhoto | null>(null);

  constructor() {
    const id = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    this.vehiculoId.set(id);
    if (id) void this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const v = await this.vehiculos.getVehiculoFull(id);
      if (v) {
        this.placa.set(v.placa);
        this.marca.set(v.marca);
        this.modelo.set(v.modelo);
        this.anio.set(v.anio);
        this.tipo.set(v.tipo);
        this.estado.set(v.estado);
        this.kilometraje.set(v.kilometraje);
        this.vencMatricula.set(v.vencimientoMatricula ?? '');
        this.vencSeguro.set(v.vencimientoSeguro ?? '');
        this.kmUltMant.set(v.kmUltimoMantenimiento);
        this.intervaloMant.set(v.intervaloMantenimientoKm);
        this.notas.set(v.notas ?? '');
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el vehículo.');
    } finally {
      this.loading.set(false);
    }
  }

  onFoto(p: CapturedPhoto): void {
    this.foto.set(p);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

  private build(): VehiculoEditable {
    return {
      placa: this.placa(),
      marca: this.marca(),
      modelo: this.modelo(),
      anio: this.anio() ?? new Date().getFullYear(),
      tipo: this.tipo(),
      estado: this.estado(),
      kilometraje: this.kilometraje() ?? 0,
      vencimientoMatricula: this.vencMatricula() || null,
      vencimientoSeguro: this.vencSeguro() || null,
      kmUltimoMantenimiento: this.kmUltMant(),
      intervaloMantenimientoKm: this.intervaloMant() ?? 5000,
      notas: this.notas() || null,
    };
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.placa().trim() || !this.marca().trim() || !this.modelo().trim() || !this.tipo().trim()) {
      this.toast.error('Completa placa, marca, modelo y tipo.');
      return;
    }
    if (this.anio() == null || this.anio()! < 1950) {
      this.toast.error('Escribe un año válido.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para guardar el vehículo.');
      return;
    }
    this.submitting.set(true);
    try {
      const data = this.build();
      const id = this.esEdicion()
        ? (await this.vehiculos.actualizarVehiculo(this.vehiculoId(), data), this.vehiculoId())
        : await this.vehiculos.crearVehiculo(data);
      const foto = this.foto();
      if (foto) await this.vehiculos.subirFotoVehiculo(id, foto.blob);
      this.toast.success(this.esEdicion() ? 'Vehículo actualizado.' : 'Vehículo creado.');
      void this.router.navigate(['/transporte/vehiculo', id], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
