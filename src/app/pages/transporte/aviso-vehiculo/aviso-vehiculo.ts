import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService, AlertasVehiculo } from '../../../core/services/vehiculos.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

type Severidad = 'baja' | 'media' | 'alta';

/**
 * AI13 — "Aviso de vehículo": (a) Reportar novedad/daño del vehículo (descripción +
 * foto(s) solo-cámara + severidad → jefe de flota/admin, push + bandeja web);
 * (b) Alertas del vehículo (documentos por vencer, mantenimiento, placa PP).
 */
@Component({
  selector: 'app-aviso-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, OptionButton, PhotoSlot, VehiculoPicker],
  templateUrl: './aviso-vehiculo.html',
  styleUrl: './aviso-vehiculo.scss',
})
export class AvisoVehiculoPage {
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  fmtFecha = formatFecha;

  tab = signal<'reportar' | 'alertas'>('reportar');
  vehiculo = signal<VehiculoDisponible | null>(null);

  // Reportar
  descripcion = signal('');
  severidad = signal<Severidad>('media');
  fotos = signal<(CapturedPhoto | null)[]>([null, null, null]);
  enviando = signal(false);

  fotosValidas = computed(() => this.fotos().filter((f): f is CapturedPhoto => !!f));
  puedeReportar = computed(() => !!(this.vehiculo() && this.descripcion().trim() && this.fotosValidas().length));

  // Alertas
  alertas = signal<AlertasVehiculo | null>(null);
  cargandoAlertas = signal(false);

  onVehiculo(v: VehiculoDisponible): void {
    this.vehiculo.set(v);
    void this.cargarAlertas();
  }

  cambiarVehiculo(): void {
    this.vehiculo.set(null);
    this.alertas.set(null);
  }

  setFoto(i: number, p: CapturedPhoto | null): void {
    this.fotos.update((list) => list.map((f, idx) => (idx === i ? p : f)));
  }

  private async cargarAlertas(): Promise<void> {
    const v = this.vehiculo();
    if (!v) return;
    this.cargandoAlertas.set(true);
    try {
      this.alertas.set(await this.vehiculos.getAlertasVehiculo(v.vehiculo_id));
    } catch {
      /* best-effort */
    } finally {
      this.cargandoAlertas.set(false);
    }
  }

  async reportar(): Promise<void> {
    const v = this.vehiculo();
    if (!v) {
      this.toast.error('Elige el vehículo.');
      return;
    }
    if (!this.descripcion().trim()) {
      this.toast.error('Describe la novedad.');
      return;
    }
    if (!this.fotosValidas().length) {
      this.toast.error('Toma al menos una foto de la novedad.');
      return;
    }
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.vehiculos.reportarNovedad({
        vehiculoId: v.vehiculo_id,
        descripcion: this.descripcion().trim(),
        severidad: this.severidad(),
        fotos: this.fotosValidas().map((f) => f.blob),
      });
      this.toast.success(
        this.network.online()
          ? 'Novedad reportada. Flota fue notificada.'
          : 'Novedad guardada. Se enviará al reconectar.',
      );
      this.descripcion.set('');
      this.severidad.set('media');
      this.fotos.set([null, null, null]);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo reportar la novedad.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
