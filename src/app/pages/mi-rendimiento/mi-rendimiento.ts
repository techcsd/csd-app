import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../shared/ui/live-refresh/live-refresh.directive';
import { IncentivoService, IncentivoSemana, IncentivoRef } from '../../core/services/incentivo.service';
import { ToastService } from '../../core/services/toast.service';
import { formatFecha, formatFechaHumana } from '../../core/util/fecha';

/** AT2 — orden y etiquetas de los renglones del informe (v1). */
const RENGLONES: { key: string; label: string; icono: string }[] = [
  { key: 'reporte_semanal', label: 'Reporte semanal', icono: '📋' },
  { key: 'inspeccion', label: 'Inspecciones de vehículo', icono: '🔧' },
  { key: 'echada', label: 'Registros de combustible', icono: '⛽' },
  { key: 'ruta', label: 'Rutas ejecutadas', icono: '🛣️' },
  { key: 'conduce', label: 'Conduces', icono: '📄' },
];

interface RenglonView {
  key: string;
  label: string;
  icono: string;
  propio: number;
  ayudante: number;
  puntos: number;
  refs: IncentivoRef[];
}

/**
 * AT2 — "Mi rendimiento": el chofer ve su puntaje de incentivo de la semana en
 * curso (badge Cumplió/Rendimiento bajo, lo que le falta para el mínimo, desglose
 * por renglón con cada número clickable hasta el registro) + el histórico de
 * semanas con su decisión (aprobado/declinado/pendiente). Distingue la actividad
 * propia de la hecha como ayudante (AT4). Destino de la push del lunes.
 */
@Component({
  selector: 'app-mi-rendimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, LiveRefreshDirective],
  templateUrl: './mi-rendimiento.html',
  styleUrl: './mi-rendimiento.scss',
})
export class MiRendimientoPage {
  private incentivo = inject(IncentivoService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  readonly fmtFecha = formatFecha;
  readonly fmtFechaHora = formatFechaHumana;

  loading = signal(true);
  semanas = signal<IncentivoSemana[]>([]);
  /** Renglón expandido (muestra sus referencias). */
  abierto = signal<string | null>(null);

  /** Semana en curso = la más reciente (el RPC ordena anio/semana desc). */
  actual = computed<IncentivoSemana | null>(() => this.semanas()[0] ?? null);
  /** Histórico = el resto. */
  historico = computed<IncentivoSemana[]>(() => this.semanas().slice(1));

  /** Desglose por renglón de la semana en curso (en orden fijo). */
  renglones = computed<RenglonView[]>(() => {
    const c = this.actual()?.conteos ?? {};
    return RENGLONES.map((r) => {
      const v = c[r.key];
      return {
        key: r.key,
        label: r.label,
        icono: r.icono,
        propio: v?.propio ?? 0,
        ayudante: v?.ayudante ?? 0,
        puntos: v?.puntos ?? 0,
        refs: v?.refs ?? [],
      };
    });
  });

  /**
   * AX4 — renglón NEGATIVO por estado estancado: días laborables (no domingo) en
   * los que el chofer no registró NINGUNA actividad ni cambió su estado. El motor
   * lo aplica con gracia + tope (config versionada AT1). Se muestra aparte, en
   * rojo, y se puede expandir para ver EXACTAMENTE qué días lo causaron (misma
   * auditabilidad que los renglones positivos). null si no hay penalización.
   */
  penalizacion = computed<RenglonView | null>(() => {
    const v = this.actual()?.conteos?.['estancamiento'];
    if (!v || (v.puntos ?? 0) >= 0) return null;
    return { key: 'estancamiento', label: 'Días sin actividad', icono: '⚠️', propio: 0, ayudante: 0, puntos: v.puntos ?? 0, refs: v.refs ?? [] };
  });

  /** Puntos que faltan para el mínimo (0 si ya cumplió). */
  faltan = computed(() => {
    const a = this.actual();
    if (!a) return 0;
    return Math.max(0, (a.minimo ?? 0) - (a.puntaje ?? 0));
  });

  /** % de avance hacia el mínimo (tope 100). */
  progreso = computed(() => {
    const a = this.actual();
    if (!a || !a.minimo) return 0;
    return Math.min(100, Math.round(((a.puntaje ?? 0) / a.minimo) * 100));
  });

  constructor() {
    void this.load();
  }

  onRefresh = (_silent = false): void => void this.load();

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.semanas.set(await this.incentivo.miRendimiento());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar tu rendimiento.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(key: string): void {
    this.abierto.set(this.abierto() === key ? null : key);
  }

  /** Rango legible de la semana: "28 jul – 3 ago". */
  rango(s: IncentivoSemana): string {
    return `${this.fmtFecha(s.inicio)} – ${this.fmtFecha(s.fin)}`;
  }

  /** Etiqueta de la decisión del incentivo de una semana. */
  decisionLabel(s: IncentivoSemana): string {
    if (s.decision === 'aprobado') return 'Aprobado';
    if (s.decision === 'declinado') return 'Declinado';
    return 'Pendiente';
  }

  /** AQ6 — navega al registro que compone el puntaje (deep-link por tipo). */
  abrirRef(ref: IncentivoRef): void {
    const url = this.rutaDe(ref);
    if (url) void this.router.navigateByUrl(url);
  }

  /** ¿El tipo tiene una vista de detalle a la que llevar? */
  esClickable(ref: IncentivoRef): boolean {
    return this.rutaDe(ref) !== null;
  }

  private rutaDe(ref: IncentivoRef): string | null {
    switch (ref.tipo) {
      case 'conduce':
        return `/transporte/conduce-detalle/${ref.id}`;
      case 'echada':
        return `/transporte/echada/${ref.id}`;
      case 'ruta':
        return `/transporte/trayectoria/${ref.id}`;
      case 'inspeccion':
        return `/transporte/mi-registro/checklist/${ref.id}`;
      default:
        // reporte_semanal (y desconocidos) no tienen vista de detalle propia.
        return null;
    }
  }

  back(): void {
    this.location.back();
  }
}
