import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { VehiculoCard } from '../../../shared/ui/vehiculo-card/vehiculo-card';
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { ReporteSemanalService } from '../../../core/services/reporte-semanal.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  RespuestaValor,
  RESPUESTA_OPCIONES,
} from '../../../core/models/checklist-preuso.model';
import { ReporteSemanalVeh } from '../../../core/models/reporte-semanal.model';
import { VehiculoDisponible } from '../../../core/models/transporte.model';

const TOTAL_STEPS = 2;

/** A pool vehicle plus this week's report status (V10). */
interface VehSemanal {
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  km: number;
  foto_path: string | null;
  tiene_reporte: boolean;
}

/**
 * Weekly vehicle report (R3). Fast form: OK/NO/NA on the template's few items,
 * fuel level, current km (coherence-checked), optional note. No signature, no
 * photos. One vehicle picker up front when the user has more than one.
 */
@Component({
  selector: 'app-reporte-semanal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, OptionButton, EmptyState, Skeleton, SyncBar, ConfirmDialog, VehiculoCard],
  templateUrl: './reporte-semanal.html',
  styleUrl: './reporte-semanal.scss',
})
export class ReporteSemanalPage extends GuardedWizard {
  private vehiculos = inject(VehiculosService);
  private conductores = inject(ConductoresService);
  private reportes = inject(ReporteSemanalService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly total = TOTAL_STEPS;
  readonly opciones = RESPUESTA_OPCIONES;

  loading = signal(true);
  semana = signal<ReporteSemanalVeh[]>([]);
  pool = signal<VehiculoDisponible[]>([]); // V10 — todos los vehículos del pool
  fotoUrls = signal<Record<string, string | null>>({}); // U6 — foto por vehículo en la lista
  plantilla = signal<ChecklistPlantilla | null>(null);
  private conductorId: string | null = null;

  // Wizard state (null = showing the vehicle picker).
  vehiculo = signal<VehSemanal | null>(null);
  odometro = signal<number | null>(null);
  step = signal(1);
  respuestas = signal<Record<string, RespuestaValor>>({});
  km = signal<number | null>(null);
  observacion = signal('');
  submitting = signal(false);
  done = signal(false);
  /** Verdict of the submitted report, for the confirmation screen (R: NO → hallazgo). */
  resultadoEnviado = signal<'aprobado' | 'con_hallazgos' | 'bloqueado'>('aprobado');

  items = computed<ChecklistPlantillaItem[]>(() => this.plantilla()?.items ?? []);

  /**
   * Ítems agrupados por sección, para mostrar los encabezados oficiales del papel
   * del jefe (§B: cada pregunta va bajo su sección). Preserva el orden de la plantilla.
   */
  seccionGrupos = computed<{ seccion: string; items: ChecklistPlantillaItem[] }[]>(() => {
    const grupos: { seccion: string; items: ChecklistPlantillaItem[] }[] = [];
    for (const it of this.items()) {
      let g = grupos.find((x) => x.seccion === it.seccion);
      if (!g) {
        g = { seccion: it.seccion, items: [] };
        grupos.push(g);
      }
      g.items.push(it);
    }
    return grupos;
  });

  /** V10 — the whole pool with this week's report status merged in, so any
   *  driver can report any vehicle even without an assignment. */
  lista = computed<VehSemanal[]>(() => {
    const status = new Map(this.semana().map((s) => [s.vehiculo_id, s]));
    return this.pool().map((v) => ({
      vehiculo_id: v.vehiculo_id,
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      tipo: v.tipo,
      km: v.km,
      foto_path: v.foto_path ?? null,
      tiene_reporte: status.get(v.vehiculo_id)?.tiene_reporte ?? false,
    }));
  });

  pendientes = computed(() => this.lista().filter((v) => !v.tiene_reporte));

  todasContestadas = computed(() => {
    const r = this.respuestas();
    return this.items().every((it) => !!r[it.id]);
  });

  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });

  constructor() {
    super();
    this.registerBackGuard();
    void this.load();
  }

  /** U4 — en el wizard con respuestas/datos sin enviar. */
  tieneDatos(): boolean {
    if (this.done() || !this.vehiculo()) return false;
    return (
      Object.keys(this.respuestas()).length > 0 ||
      this.km() != null ||
      !!this.observacion().trim()
    );
  }

  /** Descartar = volver al selector si hay vehículo en curso; si no, salir. */
  protected override salir(): void {
    if (this.vehiculo()) this.vehiculo.set(null);
    else this.location.back();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [semana, plantilla, cond, pool] = await Promise.all([
        this.reportes.getSemana(),
        this.reportes.getPlantilla(),
        this.conductores.getMiConductor(),
        this.vehiculos.getVehiculosDisponibles(),
      ]);
      this.semana.set(semana);
      this.plantilla.set(plantilla);
      this.conductorId = cond?.id ?? null;
      this.pool.set(pool);
      void this.loadFotos(pool.map((v) => v.vehiculo_id));
    } finally {
      this.loading.set(false);
    }
  }

  /** U6 — resuelve las fotos de los vehículos de la lista (mejor esfuerzo). */
  private async loadFotos(ids: string[]): Promise<void> {
    const paths = await this.vehiculos.getFotosPaths(ids);
    const urls: Record<string, string | null> = {};
    await Promise.all(
      Object.entries(paths).map(async ([id, p]) => {
        urls[id] = p ? await this.vehiculos.getFotoUrl(p) : null;
      }),
    );
    this.fotoUrls.set(urls);
  }

  elegir(v: VehSemanal): void {
    this.vehiculo.set(v);
    this.step.set(1);
    this.respuestas.set({});
    this.km.set(null);
    this.observacion.set('');
    // Baseline km for coherence: the pool vehicle's current odometer.
    this.odometro.set(v.km ?? null);
  }

  setRespuesta(itemId: string, valor: RespuestaValor): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: valor }));
  }

  next(): void {
    if (this.step() === 1 && !this.todasContestadas()) {
      this.toast.error('Responde todas las preguntas.');
      return;
    }
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  private resultadoLocal(): 'aprobado' | 'con_hallazgos' | 'bloqueado' {
    const r = this.respuestas();
    const items = this.items();
    const hayCriticoNo = items.some((it) => it.es_critico && r[it.id] === 'no');
    if (hayCriticoNo) return 'bloqueado';
    const hayNo = items.some((it) => r[it.id] === 'no');
    return hayNo ? 'con_hallazgos' : 'aprobado';
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const veh = this.vehiculo();
    const plantilla = this.plantilla();
    if (!veh || !plantilla) return;
    if (this.km() == null || this.km()! <= 0) {
      this.toast.error('Escribe el kilometraje actual.');
      return;
    }
    this.submitting.set(true);
    try {
      const r = this.respuestas();
      const respuestas = this.items().map((it) => ({
        etiqueta: it.etiqueta,
        seccion: it.seccion,
        es_critico: it.es_critico,
        respuesta: r[it.id],
        comentario: null,
        orden: it.orden,
      }));
      const resultado = this.resultadoLocal();
      await this.reportes.enqueue({
        vehiculoId: veh.vehiculo_id,
        placa: veh.placa,
        plantillaId: plantilla.id,
        conductorId: this.conductorId,
        fecha: new Date().toISOString().slice(0, 10),
        kilometraje: this.km(),
        nivelCombustible: null,
        observacion: this.observacion().trim() || null,
        respuestas,
        resultado,
      });
      this.resultadoEnviado.set(resultado);
      this.done.set(true);
      // Refresh the compliance list for when the user goes back.
      this.semana.set(await this.reportes.getSemana());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    this.done.set(false);
    this.vehiculo.set(null);
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  get online(): boolean {
    return this.network.online();
  }
}
