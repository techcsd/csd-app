import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { CronogramaService, TareaAccionPendiente } from '../../../core/services/cronograma.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { SyncService } from '../../../core/sync/sync.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import {
  CronogramaData,
  CronogramaTarea,
  CronogramaEstado,
  CRONOGRAMA_TIPO_LABEL,
  CRONOGRAMA_ESTADO_LABEL,
  CRONOGRAMA_MOTIVOS,
  esTareaAtrasada,
} from '../../../core/models/cronograma.model';
import { formatFecha } from '../../../core/util/fecha';

/** Barra de timeline calculada (posición y ancho en % del rango total). */
interface BarraTimeline {
  tarea: CronogramaTarea;
  leftPct: number;
  widthPct: number;
  estado: CronogramaEstado;
  atrasada: boolean;
}

const DAY_MS = 86_400_000;
function dayNum(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/**
 * Y15 (PROMPT-4 FASE 2/3) — Cronograma del proyecto en la app: timeline simple
 * (barras CSS, color por tipo, plan vs real, línea de hoy) + lista + detalle de
 * tarea. Acciones Iniciar/Completar por el outbox (offline-first) con marcado
 * optimista y reconciliación al sync.
 */
@Component({
  selector: 'app-cronograma',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, BottomSheet, PhotoSlot],
  templateUrl: './cronograma.html',
  styleUrl: './cronograma.scss',
})
export class CronogramaPage {
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private sync = inject(SyncService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  readonly tipoLabel = CRONOGRAMA_TIPO_LABEL;
  readonly estadoLabel = CRONOGRAMA_ESTADO_LABEL;
  readonly motivoLabel = CRONOGRAMA_MOTIVOS;

  private proyectoId = this.route.snapshot.paramMap.get('id') ?? '';
  private tareaDeep = this.route.snapshot.queryParamMap.get('tarea'); // deep-link de aviso

  data = signal<CronogramaData>({ tareas: [], recalculos: [] });
  pend = signal<Map<string, TareaAccionPendiente>>(new Map());
  puedeGestionar = signal(false);
  loading = signal(true);
  // AW1 — vacío ≠ error: si la carga FALLA lo decimos ("no pudimos cargar…" +
  // reintentar) en vez de pintar "Sin tareas" (patrón AU5/AS2). null = sin error.
  error = signal<string | null>(null);
  vista = signal<'lista' | 'timeline'>('lista');
  readonly hoyIso = new Date().toISOString().slice(0, 10);

  // Hoja de detalle / completar.
  selected = signal<CronogramaTarea | null>(null);
  modo = signal<'detalle' | 'completar'>('detalle');
  evidenciaUrl = signal<string | null>(null);
  fotoCompletar = signal<CapturedPhoto | null>(null);
  justificacion = signal('');
  submitting = signal(false);

  constructor() {
    // Recarga al montar y tras cada cambio del outbox (para reflejar el drain).
    effect(() => {
      this.sync.changed();
      void this.recargarPend();
    });
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null); // AW1 — reintento limpio
    try {
      const [data, puede] = await Promise.all([
        this.cronograma.listar(this.proyectoId),
        this.cronograma.puedeGestionar(this.proyectoId).catch(() => false),
      ]);
      this.data.set(data);
      this.puedeGestionar.set(puede);
      await this.recargarPend();
      // Deep-link de aviso: abrir la tarea indicada.
      if (this.tareaDeep) {
        const t = data.tareas.find((x) => x.id === this.tareaDeep);
        if (t) this.abrirDetalle(t);
        else this.toast.show('Esa tarea ya no está disponible.', 'info'); // AS24 #12
        this.tareaDeep = null;
      }
    } catch (e) {
      // AW1/AS24 #2 — un fallo de carga NO es "sin cronograma": se marca como error
      // para pintar el estado de reintento (nunca el empty-state "Sin tareas").
      this.error.set(e instanceof Error ? e.message : 'No pudimos cargar el cronograma.');
    } finally {
      this.loading.set(false);
    }
  }

  private async recargarPend(): Promise<void> {
    this.pend.set(await this.cronograma.accionesPendientes());
  }

  get online(): boolean {
    return this.network.online();
  }

  // ─── Vista ───
  // AW1 — un proyecto DE PRUEBA (Riviera Bay TEST) tiene TODAS sus tareas es_prueba;
  // el server ya las devuelve a cualquiera que pueda ver el proyecto (fix PROMPT-9).
  // Antes el belt AS24 #8 (filter !es_prueba) las ocultaba TODAS → salía vacío para
  // no-admin. Ahora: si el proyecto es de prueba, se muestran; si es un proyecto real,
  // se sigue ocultando una tarea de prueba SUELTA (belt intacto para producción).
  private esProyectoPrueba = computed(() => {
    const all = this.data().tareas;
    return all.length > 0 && all.every((t) => t.es_prueba);
  });
  tareas = computed(() => {
    const all = this.data().tareas;
    return this.esProyectoPrueba() ? all : all.filter((t) => !t.es_prueba);
  });

  estado(t: CronogramaTarea): CronogramaEstado {
    return this.cronograma.estadoEfectivo(t, this.pend().get(t.id));
  }
  enviando(t: CronogramaTarea): boolean {
    return this.pend().has(t.id);
  }
  atrasada(t: CronogramaTarea): boolean {
    return this.estado(t) !== 'completada' && esTareaAtrasada(t, this.hoyIso);
  }

  fmt(iso: string | null): string {
    return iso ? formatFecha(iso) : '—';
  }

  /** Barras del timeline (posición/ancho en % sobre el rango plan del proyecto). */
  barras = computed<BarraTimeline[]>(() => {
    const ts = this.tareas();
    const starts = ts.map((t) => dayNum(t.fecha_inicio_plan)).filter((x): x is number => x != null);
    const ends = ts.map((t) => dayNum(t.fecha_fin_plan)).filter((x): x is number => x != null);
    if (!starts.length || !ends.length) return [];
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    const total = Math.max(1, max - min + 1);
    return ts.map((t) => {
      const s = dayNum(t.fecha_inicio_plan) ?? min;
      const e = dayNum(t.fecha_fin_plan) ?? s;
      return {
        tarea: t,
        leftPct: ((s - min) / total) * 100,
        widthPct: (Math.max(1, e - s + 1) / total) * 100,
        estado: this.estado(t),
        atrasada: this.atrasada(t),
      };
    });
  });

  hoyPct = computed<number | null>(() => {
    const ts = this.tareas();
    const starts = ts.map((t) => dayNum(t.fecha_inicio_plan)).filter((x): x is number => x != null);
    const ends = ts.map((t) => dayNum(t.fecha_fin_plan)).filter((x): x is number => x != null);
    if (!starts.length || !ends.length) return null;
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    const total = Math.max(1, max - min + 1);
    const hoy = dayNum(this.hoyIso)!;
    const pct = ((hoy - min) / total) * 100;
    return pct < 0 || pct > 100 ? null : pct;
  });

  /**
   * AS24 #1 — la línea "Hoy" vive en el contenedor completo, pero las barras
   * empiezan tras la columna de nombre (40%). Se desplaza al mismo origen que las
   * barras: 40% + (pct dentro del track × 60%). Mantener sincronizado con el ancho
   * de `.crono__row-name` en el SCSS (40%).
   */
  private readonly NAME_COL_PCT = 40;
  hoyLeftPct = computed<number | null>(() => {
    const p = this.hoyPct();
    return p == null ? null : this.NAME_COL_PCT + (p * (100 - this.NAME_COL_PCT)) / 100;
  });

  setVista(v: 'lista' | 'timeline'): void {
    this.vista.set(v);
  }

  /** AS21 — importar cronograma desde Excel (.xlsx). */
  importar(): void {
    void this.router.navigate(['/proyectos', this.proyectoId, 'cronograma', 'importar']);
  }

  // ─── Detalle / acciones ───
  abrirDetalle(t: CronogramaTarea): void {
    this.selected.set(t);
    this.modo.set('detalle');
    this.evidenciaUrl.set(null);
    if (t.foto_evidencia_path) {
      void this.cronograma.getEvidenciaUrl(t.foto_evidencia_path).then((u) => this.evidenciaUrl.set(u));
    }
  }
  cerrarHoja(): void {
    this.selected.set(null);
    this.fotoCompletar.set(null);
    this.justificacion.set('');
  }

  async iniciar(t: CronogramaTarea): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.cronograma.enqueueIniciar(t.id, this.proyectoId);
      this.pend.update((m) => new Map(m).set(t.id, 'iniciar'));
      this.toast.success('Tarea iniciada. Se enviará al sincronizar.');
      this.cerrarHoja();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo iniciar.');
    } finally {
      this.submitting.set(false);
    }
  }

  abrirCompletar(): void {
    this.modo.set('completar');
  }

  onFoto(p: CapturedPhoto): void {
    this.fotoCompletar.set(p);
  }
  onFotoCleared(): void {
    this.fotoCompletar.set(null);
  }

  /** ¿La tarea seleccionada está atrasada (exige justificación al completar)? */
  selAtrasada = computed(() => {
    const t = this.selected();
    return t ? this.atrasada(t) : false;
  });

  async completar(): Promise<void> {
    const t = this.selected();
    if (!t || this.submitting()) return;
    if (!this.fotoCompletar()) {
      this.toast.error('Agrega la foto de evidencia para completar.');
      return;
    }
    if (this.selAtrasada() && !this.justificacion().trim()) {
      this.toast.error('La tarea está atrasada: escribe la justificación.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.cronograma.enqueueCompletar({
        tareaId: t.id,
        proyectoId: this.proyectoId,
        fotoEvidencia: this.fotoCompletar()!.blob,
        justificacion: this.justificacion().trim() || null,
      });
      this.pend.update((m) => new Map(m).set(t.id, 'completar'));
      this.toast.success('Tarea completada. Se enviará al sincronizar.');
      this.cerrarHoja();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
