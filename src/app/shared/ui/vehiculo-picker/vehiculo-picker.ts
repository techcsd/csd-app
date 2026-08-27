import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { VehiculoCard } from '../vehiculo-card/vehiculo-card';
import { EmptyState } from '../empty-state/empty-state';
import { Skeleton } from '../skeleton/skeleton';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoUsoService } from '../../../core/services/vehiculo-uso.service';
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
  private usoSvc = inject(VehiculoUsoService);

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
  /** AW16 — muestra "En uso · [usuario]" por ítem EN el picker (no solo post-selección).
   *  Opt-in: solo lo piden los flujos de roles elevados (planificar/asignar). Best-effort:
   *  si el usuario no puede leer vehiculos_en_uso, el mapa queda vacío y no pinta nada. */
  mostrarEnUso = input(false);

  elegido = output<VehiculoDisponible>();

  /** AW16 — vehiculo_id → nombre del usuario que lo tiene en uso ahora mismo. */
  enUso = signal<Record<string, string>>({});

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
  /** W4 — ids "míos": asignaciones + recepciones en cola + vehículos que tengo EN USO
   *  ahora (uso v2). Incluir el "en uso" es clave: un chofer puede estar usando un
   *  vehículo que NO es su asignación formal (lo recibió), y debe poder echarle gas. */
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
      // W4 — cargar disponibles + mis asignaciones/recepciones + mis usos activos.
      const [disp, asignaciones, recepcionesEnCola, misUsos] = await Promise.all([
        this.vehiculos.getVehiculosDisponibles(),
        this.vehiculos.getMisAsignaciones().catch(() => []),
        this.vehiculos.entregasRecepcionPendientes().catch(() => new Set<string>()),
        this.usoSvc.misUsos().catch(() => []),
      ]);
      this.disponibles.set(disp);
      // "Tus vehículos" = lo que REALMENTE manejas. El "en uso" (uso v2) manda sobre
      // la asignación formal, que puede estar vieja: p. ej. Manolo está asignado a la
      // Nissan (que hoy usa OTRO) pero él maneja la KIA. Si tienes algo EN USO, esos
      // (+ recepciones en cola) son "los tuyos"; solo si NO tienes ninguno en uso caemos
      // a la asignación formal. Así no aparece un vehículo que no estás usando.
      const enUsoMios = misUsos.filter((u) => u.activa).map((u) => u.vehiculo_id);
      const recep = [...recepcionesEnCola];
      const idsMios = enUsoMios.length
        ? [...enUsoMios, ...recep]
        : [...asignaciones.map((a) => a.vehiculo_id), ...recep];
      this.misIds.set(new Set(idsMios));
      void this.resolveFotos(disp);
      // AW16 — quién tiene cada vehículo EN USO ahora (best-effort; requiere permiso).
      if (this.mostrarEnUso()) {
        void this.vehiculos
          .getVehiculosEnUso()
          .then((rows) => {
            const map: Record<string, string> = {};
            for (const r of rows) map[r.vehiculo_id] = r.usuario_nombre ?? 'Alguien';
            this.enUso.set(map);
          })
          .catch(() => {});
      }
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
