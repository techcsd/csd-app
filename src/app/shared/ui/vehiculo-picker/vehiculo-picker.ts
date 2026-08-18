import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { VehiculoCard } from '../vehiculo-card/vehiculo-card';
import { EmptyState } from '../empty-state/empty-state';
import { Skeleton } from '../skeleton/skeleton';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoDisponible, vehiculoIdentidad } from '../../../core/models/transporte.model';

/**
 * B1 — reusable pool-of-vehicles picker (tarjetas con foto). Loads the shared
 * available pool (getVehiculosDisponibles, same as "asignarme"/semanal) and
 * emits the chosen vehicle. Used as an embedded step-1 in pre-uso, combustible
 * and rutas so a driver can start any flow without a prior assignment (U1/V10).
 */
@Component({
  selector: 'app-vehiculo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VehiculoCard, EmptyState, Skeleton],
  templateUrl: './vehiculo-picker.html',
  styleUrl: './vehiculo-picker.scss',
})
export class VehiculoPicker {
  private vehiculos = inject(VehiculosService);

  /** AT9 — identificación homologada Marca Modelo · Color · Placa (para el chip). */
  ident = vehiculoIdentidad;

  /** Optional heading shown above the list. */
  titulo = input('Elige un vehículo');
  subtitulo = input('Selecciona el vehículo disponible para continuar.');
  /** AF18 — cuando true, solo ofrece los vehículos asignados a mí (combustible). */
  soloMios = input(false);
  /** AK6 — modo dropdown: cerrado por defecto (trigger) → abre al tap → colapsa
   *  mostrando el vehículo elegido + "Cambiar". Para selectores embebidos en un
   *  formulario (combustible, multa, aviso, rutas). Los pasos dedicados de un
   *  wizard lo dejan en false (la cuadrícula ES el paso). */
  dropdown = input(false);
  /** AK6 — id del vehículo ya elegido (para pintar el chip colapsado). */
  selectedId = input<string>('');

  elegido = output<VehiculoDisponible>();

  /** AK6 — la cuadrícula está abierta (el usuario tocó el trigger/"Cambiar"). */
  abierto = signal(false);
  /** AK6 — vehículo actualmente seleccionado (para el chip colapsado). */
  seleccionadoV = computed(
    () => this.disponibles().find((v) => v.vehiculo_id === this.selectedId()) ?? null,
  );
  /** AK6 — muestra la cuadrícula: siempre en modo normal; en dropdown solo si está abierto. */
  mostrarLista = computed(() => !this.dropdown() || this.abierto());

  loading = signal(true);
  disponibles = signal<VehiculoDisponible[]>([]);
  fotoUrls = signal<Record<string, string>>({});
  /** W4 — ids de vehículos asignados a mí (asignaciones + recepciones en cola). */
  misIds = signal<Set<string>>(new Set());

  /** W4 — "Tus vehículos" primero. */
  mios = computed(() => this.disponibles().filter((v) => this.misIds().has(v.vehiculo_id)));
  /** W4 — el resto de la flota disponible (oculto cuando soloMios, AF18). */
  resto = computed(() =>
    this.soloMios() ? [] : this.disponibles().filter((v) => !this.misIds().has(v.vehiculo_id)),
  );
  /** AF18 — soloMios y no tengo ninguno asignado → mensaje claro (no lista ajena). */
  sinAsignado = computed(() => this.soloMios() && !this.loading() && !this.mios().length);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // W4 — cargar disponibles + mis asignaciones/recepciones en paralelo.
      const [disp, asignaciones, recepcionesEnCola] = await Promise.all([
        this.vehiculos.getVehiculosDisponibles(),
        this.vehiculos.getMisAsignaciones().catch(() => []),
        this.vehiculos.entregasRecepcionPendientes().catch(() => new Set<string>()),
      ]);
      this.disponibles.set(disp);
      this.misIds.set(new Set([...asignaciones.map((a) => a.vehiculo_id), ...recepcionesEnCola]));
      void this.resolveFotos(disp);
    } finally {
      this.loading.set(false);
    }
  }

  /** U6 — resolve pool photos to signed URLs (best-effort, online). */
  private async resolveFotos(disp: VehiculoDisponible[]): Promise<void> {
    await Promise.all(
      disp
        .filter((v) => v.foto_path)
        .map(async (v) => {
          const url = await this.vehiculos.getFotoUrl(v.foto_path);
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.vehiculo_id]: url }));
        }),
    );
  }

  elegir(v: VehiculoDisponible): void {
    this.abierto.set(false); // AK6 — al elegir, colapsa el dropdown
    this.elegido.emit(v);
  }

  /** AK6 — abre la cuadrícula (modo dropdown). */
  abrir(): void {
    this.abierto.set(true);
  }
}
