import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import {
  VehiculoUsoService,
  EstadoUso,
  NivelCombustible,
  NIVELES_COMBUSTIBLE,
  VehiculoEnUsoError,
} from '../../../core/services/vehiculo-uso.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { formatFechaHumana } from '../../../core/util/fecha';

type Modo = 'usar' | 'soltar';

/**
 * AK14/AK15/AK20 — "Uso de vehículo" v2 (reemplaza asignarme + pre-uso + recibir):
 *  - Vehículo libre → captura km + nivel de gasolina → inicia sesión de uso.
 *  - En uso por OTRO → "recibir de X" (la responsabilidad pasa a mí).
 *  - En uso por mí → ofrece "Soltar vehículo" (lo deja libre pidiendo km + nivel).
 * Poco friccionante (el estado del vehículo lo cubre el reporte semanal).
 */
@Component({
  selector: 'app-uso-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, OptionButton, VehiculoPicker],
  templateUrl: './uso-vehiculo.html',
  styleUrl: './uso-vehiculo.scss',
})
export class UsoVehiculoPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private usoSvc = inject(VehiculoUsoService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  readonly niveles = NIVELES_COMBUSTIBLE;
  readonly fmtFechaHora = formatFechaHumana;

  vehiculoId = signal('');
  placa = signal('');
  etiqueta = signal(''); // "PLACA · Marca Modelo"
  modo = signal<Modo>('usar');

  loading = signal(false);
  estado = signal<EstadoUso | null>(null);
  submitting = signal(false);
  done = signal(false);

  // Captura
  km = signal<number | null>(null);
  nivel = signal<NivelCombustible | null>(null);
  notas = signal('');

  /** El vehículo lo tiene otro → flujo "recibir de X". */
  enUsoPorOtro = computed(() => {
    const e = this.estado();
    return !!e && !e.libre && !e.es_mio;
  });
  /** Ya lo tengo en uso yo. */
  enUsoPorMi = computed(() => {
    const e = this.estado();
    return !!e && !e.libre && !!e.es_mio;
  });
  libre = computed(() => this.estado()?.libre === true);

  /** ¿Se muestra el formulario de captura (km + nivel)? */
  mostrarForm = computed(
    () => this.libre() || this.enUsoPorOtro() || (this.enUsoPorMi() && this.modo() === 'soltar'),
  );

  puedeGuardar = computed(() => this.nivel() != null && !this.submitting());

  ctaLabel = computed(() => {
    if (this.submitting()) return 'Guardando…';
    if (this.modo() === 'soltar') return 'Soltar vehículo';
    if (this.enUsoPorOtro()) return 'Recibir vehículo';
    return 'Comenzar a usar';
  });

  titulo = computed(() => (this.modo() === 'soltar' ? 'Soltar vehículo' : 'Uso de vehículo'));

  constructor() {
    const id = this.route.snapshot.paramMap.get('vehiculoId');
    const q = this.route.snapshot.queryParamMap;
    this.modo.set(q.get('mode') === 'soltar' ? 'soltar' : 'usar');
    this.placa.set(q.get('placa') ?? '');
    this.etiqueta.set(q.get('label') ?? q.get('placa') ?? '');
    if (id) {
      this.vehiculoId.set(id);
      void this.cargarEstado();
    }
  }

  onVehiculoElegido(v: VehiculoDisponible): void {
    this.vehiculoId.set(v.vehiculo_id);
    this.placa.set(v.placa);
    this.etiqueta.set(`${v.placa} · ${v.marca} ${v.modelo}`);
    if (v.km != null) this.km.set(v.km);
    void this.cargarEstado();
  }

  private async cargarEstado(): Promise<void> {
    this.loading.set(true);
    try {
      const e = await this.usoSvc.estadoUso(this.vehiculoId());
      this.estado.set(e);
      // Prefill km con el del inicio si lo tengo (mejor que vacío).
      if (e.km_inicio != null && this.km() == null) this.km.set(e.km_inicio);
    } catch {
      this.toast.error('No pudimos consultar el estado del vehículo. Revisa tu conexión.');
    } finally {
      this.loading.set(false);
    }
  }

  setNivel(n: NivelCombustible): void {
    this.nivel.set(n);
  }

  cambiarVehiculo(): void {
    this.vehiculoId.set('');
    this.estado.set(null);
    this.nivel.set(null);
    this.km.set(null);
  }

  async guardar(): Promise<void> {
    if (!this.puedeGuardar() || !this.vehiculoId()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para registrar el uso del vehículo.');
      return;
    }
    this.submitting.set(true);
    try {
      if (this.modo() === 'soltar') {
        await this.usoSvc.soltar({
          vehiculoId: this.vehiculoId(),
          km: this.km(),
          nivel: this.nivel()!,
          notas: this.notas().trim() || null,
        });
        this.toast.success('Vehículo soltado. Queda libre.');
      } else {
        await this.usoSvc.iniciarUso({
          vehiculoId: this.vehiculoId(),
          km: this.km(),
          nivel: this.nivel()!,
          notas: this.notas().trim() || null,
          recibir: this.enUsoPorOtro(),
        });
        this.toast.success(this.enUsoPorOtro() ? 'Recibiste el vehículo. Ahora está a tu cargo.' : 'Estás usando el vehículo.');
      }
      this.done.set(true);
      this.router.navigate(['/transporte'], { replaceUrl: true });
    } catch (e) {
      if (e instanceof VehiculoEnUsoError) {
        // El estado cambió entre la consulta y el submit: re-consulta para ofrecer "recibir de X".
        this.toast.show(`Ahora lo tiene ${e.nombre ?? 'otro usuario'}. Puedes recibirlo.`, 'info');
        await this.cargarEstado();
      } else {
        this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar. Intenta de nuevo.');
      }
    } finally {
      this.submitting.set(false);
    }
  }

  /** Pasa del modo "ya lo tengo" al formulario de soltar. */
  irSoltar(): void {
    this.modo.set('soltar');
    this.nivel.set(null);
  }

  back(): void {
    this.navGuard.back('/transporte');
  }
}
