import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TrabajosService, BandejaRow, ChoferPanel } from '../../../core/services/trabajos.service';
import { ConducesService } from '../../../core/services/conduces.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatFecha } from '../../../core/util/fecha';
import { esUuid } from '../../../core/util/validar';

/** CK15 — llave de cada pestaña de la bandeja. */
type TabKey = 'sin_asignar' | 'asignados' | 'en_proceso' | 'por_confirmar' | 'completados';

/** CK15 — etiqueta del tipo de trabajo (escaneable). */
const TIPO_LABEL: Record<string, string> = {
  movimiento_interno: 'Movimiento interno',
  retiro_material: 'Retiro de material',
  bote: 'Bote',
  conduce: 'Conduce',
  actividad: 'Actividad',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Sin asignar',
  asignada: 'Asignado',
  en_proceso: 'En proceso',
  por_confirmar: 'Por confirmar',
  completada: 'Completado',
  cancelada: 'Cancelado',
};

/** CK15 — opción de chofer en la hoja de asignar (nombre + estado + carga de hoy). */
interface ChoferOpcion {
  id: string;
  label: string;
  estado: string;
  trabajosHoy: number;
}

const ESTADO_CHOFER_LABEL: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  descanso: 'En descanso',
  almuerzo: 'En almuerzo',
  inactivo: 'Inactivo',
  sin_estado: 'Sin estado',
};

/**
 * CK15 — "Trabajos de transporte": la bandeja de Misael (gate es_flota_elevado).
 * Pestañas Sin asignar · Asignados · En proceso · Por confirmar · Completados hoy;
 * filtros día/obra/tipo/chofer. Por ticket: Asignar/Reasignar (hoja con choferes
 * activos + su estado y carga de hoy) y Cancelar (solo apoyos). "Nueva actividad"
 * crea un ticket manual. Todo con componentes existentes (piel CB, sin tropos).
 */
@Component({
  selector: 'app-trabajos-transporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, BottomSheet, LiveRefreshDirective, TranslatePipe],
  templateUrl: './trabajos-transporte.html',
  styleUrl: './trabajos-transporte.scss',
})
export class TrabajosTransportePage {
  private trabajosSvc = inject(TrabajosService);
  private conduces = inject(ConducesService);
  private inventario = inject(InventarioService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);

  fmtDia = formatFecha;

  /** Glifos desde TS (guarda AW12/no-ai-tropes: nada de emoji literal en la plantilla). */
  readonly glyph = {
    header: '🚚',
    refresh: '🔄',
    empty: '📭',
    obra: '🏗️',
    dia: '📅',
    chofer: '👤',
    vehiculo: '🚗',
    asignar: '➕',
    reasignar: '🔁',
    cancelar: '✖️',
    nueva: '🆕',
    filtro: '🧰',
  };

  readonly tabs: { key: TabKey; label: string }[] = [
    { key: 'sin_asignar', label: 'Sin asignar' },
    { key: 'asignados', label: 'Asignados' },
    { key: 'en_proceso', label: 'En proceso' },
    { key: 'por_confirmar', label: 'Por confirmar' },
    { key: 'completados', label: 'Completados hoy' },
  ];

  loading = signal(true);
  refrescando = signal(false);
  rows = signal<BandejaRow[]>([]);
  tab = signal<TabKey>('sin_asignar');

  // Filtros (día es server-side; obra/tipo/chofer se derivan de las filas cargadas).
  diaFiltro = signal<string>('');
  filtroObra = signal<string>('');
  filtroTipo = signal<string>('');
  filtroChofer = signal<string>('');
  filtrosAbiertos = signal(false);

  // Hoja "Asignar / Reasignar".
  asignando = signal<BandejaRow | null>(null);
  choferes = signal<ChoferOpcion[]>([]);
  cargandoChoferes = signal(false);
  enviando = signal(false);

  // Hoja "Nueva actividad".
  nuevaAbierta = signal(false);
  nuevaDesc = signal('');
  nuevaObra = signal<string>('');
  nuevaDia = signal<string>('');
  nuevaChofer = signal<string>('');
  obras = signal<{ id: string; nombre: string }[]>([]);
  creando = signal(false);

  private hoy = this.hoyLocal();

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.trabajosSvc.bandeja({ dia: this.diaFiltro() || null }));
    } finally {
      this.loading.set(false);
    }
  }

  async refrescar(): Promise<void> {
    this.refrescando.set(true);
    try {
      await this.trabajosSvc.invalidarBandeja();
      this.rows.set(await this.trabajosSvc.bandeja({ dia: this.diaFiltro() || null }));
    } finally {
      this.refrescando.set(false);
    }
  }

  onDiaFiltro(v: string): void {
    this.diaFiltro.set(v);
    void this.load();
  }

  limpiarFiltros(): void {
    this.filtroObra.set('');
    this.filtroTipo.set('');
    this.filtroChofer.set('');
    if (this.diaFiltro()) {
      this.diaFiltro.set('');
      void this.load();
    }
  }

  // ── Derivaciones ─────────────────────────────────────────────────────────────
  tipoLabel(t: BandejaRow): string {
    return TIPO_LABEL[t.tipo] ?? 'Trabajo';
  }
  estadoLabel(t: BandejaRow): string {
    return ESTADO_LABEL[t.estado] ?? t.estado;
  }

  /** Opciones de obra presentes en las filas cargadas (para el filtro). */
  obraOpciones = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.rows()) if (r.proyectoId && r.proyecto) map.set(r.proyectoId, r.proyecto);
    return [...map].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  tipoOpciones = computed(() => {
    const set = new Set<string>();
    for (const r of this.rows()) if (r.tipo) set.add(r.tipo);
    return [...set].map((t) => ({ id: t, nombre: TIPO_LABEL[t] ?? t }));
  });

  choferOpciones = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.rows()) if (r.conductorId && r.conductor) map.set(r.conductorId, r.conductor);
    return [...map].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** Filas que caen en una pestaña (antes de aplicar obra/tipo/chofer). */
  private enTab(r: BandejaRow, tab: TabKey): boolean {
    switch (tab) {
      case 'sin_asignar':
        return !r.conductorId && r.estado !== 'completada' && r.estado !== 'cancelada';
      case 'asignados':
        return r.estado === 'asignada';
      case 'en_proceso':
        return r.estado === 'en_proceso';
      case 'por_confirmar':
        return r.estado === 'por_confirmar';
      case 'completados':
        return r.estado === 'completada' && r.dia === this.hoy;
    }
  }

  private pasaFiltros(r: BandejaRow): boolean {
    if (this.filtroObra() && r.proyectoId !== this.filtroObra()) return false;
    if (this.filtroTipo() && r.tipo !== this.filtroTipo()) return false;
    if (this.filtroChofer() && r.conductorId !== this.filtroChofer()) return false;
    return true;
  }

  visibles = computed(() => {
    const tab = this.tab();
    return this.rows().filter((r) => this.enTab(r, tab) && this.pasaFiltros(r));
  });

  /** Conteo por pestaña (respeta los filtros obra/tipo/chofer activos). */
  conteo(tab: TabKey): number {
    return this.rows().filter((r) => this.enTab(r, tab) && this.pasaFiltros(r)).length;
  }

  /** CK15 — "sin asignar" para el contador del menú/tile (sin filtros). */
  sinAsignar = computed(() => this.rows().filter((r) => this.enTab(r, 'sin_asignar')).length);

  // ── Asignar / Reasignar ──────────────────────────────────────────────────────
  async abrirAsignar(r: BandejaRow): Promise<void> {
    this.asignando.set(r);
    if (this.choferes().length) return; // ya cargados
    this.cargandoChoferes.set(true);
    try {
      const [activos, panel] = await Promise.all([
        this.conduces.choferesParaTransferir().catch(() => [] as { id: string; label: string }[]),
        this.trabajosSvc.misChoferes().catch(() => [] as ChoferPanel[]),
      ]);
      const porId = new Map(panel.map((p) => [p.conductorId, p]));
      this.choferes.set(
        activos
          .filter((c) => esUuid(c.id))
          .map((c) => {
            const p = porId.get(c.id);
            return { id: c.id, label: c.label, estado: p?.estado ?? 'sin_estado', trabajosHoy: p?.trabajosHoy ?? 0 };
          }),
      );
    } finally {
      this.cargandoChoferes.set(false);
    }
  }

  estadoChoferLabel(e: string): string {
    return ESTADO_CHOFER_LABEL[e] ?? e;
  }

  async asignarA(c: ChoferOpcion): Promise<void> {
    const r = this.asignando();
    if (!r || this.enviando()) return;
    if (!esUuid(c.id)) {
      this.toast.error(this.i18n.t('No pudimos identificar al chofer. Intenta de nuevo.'));
      return;
    }
    this.enviando.set(true);
    try {
      await this.trabajosSvc.asignar({
        origen: r.origen,
        origenId: r.origenId,
        conductorId: c.id,
        dia: r.dia,
      });
      this.toast.success(this.i18n.t('Asignado a') + ' ' + c.label + '.');
      this.asignando.set(null);
      await this.load();
    } catch (e) {
      this.toast.error((e as Error)?.message || this.i18n.t('No se pudo asignar. Intenta de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ── Cancelar (solo apoyos) ────────────────────────────────────────────────────
  puedeCancelar(r: BandejaRow): boolean {
    return this.trabajosSvc.puedeCancelar(r);
  }

  cancelando = signal<BandejaRow | null>(null);
  motivoCancelar = signal('');

  abrirCancelar(r: BandejaRow): void {
    this.motivoCancelar.set('');
    this.cancelando.set(r);
  }

  async confirmarCancelar(): Promise<void> {
    const r = this.cancelando();
    if (!r || this.enviando()) return;
    const motivo = this.motivoCancelar().trim();
    if (!motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo de la cancelación.'));
      return;
    }
    this.enviando.set(true);
    try {
      await this.trabajosSvc.cancelar({ origen: r.origen, origenId: r.origenId, motivo });
      this.toast.success(this.i18n.t('Ticket cancelado. Se avisó al solicitante.'));
      this.cancelando.set(null);
      await this.load();
    } catch (e) {
      this.toast.error((e as Error)?.message || this.i18n.t('No se pudo cancelar. Intenta de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ── Nueva actividad ────────────────────────────────────────────────────────────
  async abrirNueva(): Promise<void> {
    this.nuevaDesc.set('');
    this.nuevaObra.set('');
    this.nuevaDia.set('');
    this.nuevaChofer.set('');
    this.nuevaAbierta.set(true);
    if (!this.obras().length) {
      try {
        const l = await this.inventario.getProyectosConUbicacion();
        this.obras.set(l.map((p) => ({ id: p.id, nombre: p.nombre })));
      } catch {
        /* best-effort: la obra es opcional */
      }
    }
    // Choferes para el selector opcional de la actividad.
    if (!this.choferes().length) void this.precargarChoferes();
  }

  private async precargarChoferes(): Promise<void> {
    try {
      const [activos, panel] = await Promise.all([
        this.conduces.choferesParaTransferir().catch(() => [] as { id: string; label: string }[]),
        this.trabajosSvc.misChoferes().catch(() => [] as ChoferPanel[]),
      ]);
      const porId = new Map(panel.map((p) => [p.conductorId, p]));
      this.choferes.set(
        activos
          .filter((c) => esUuid(c.id))
          .map((c) => ({
            id: c.id,
            label: c.label,
            estado: porId.get(c.id)?.estado ?? 'sin_estado',
            trabajosHoy: porId.get(c.id)?.trabajosHoy ?? 0,
          })),
      );
    } catch {
      /* best-effort */
    }
  }

  async crearActividad(): Promise<void> {
    if (this.creando()) return;
    const desc = this.nuevaDesc().trim();
    if (!desc) {
      this.toast.error(this.i18n.t('Describe la actividad.'));
      return;
    }
    this.creando.set(true);
    try {
      const chofer = this.nuevaChofer();
      await this.trabajosSvc.nuevaActividad({
        descripcion: desc,
        proyectoId: this.nuevaObra() || null,
        dia: this.nuevaDia() || null,
        conductorId: chofer && esUuid(chofer) ? chofer : null,
      });
      this.toast.success(this.i18n.t('Actividad creada.'));
      this.nuevaAbierta.set(false);
      await this.load();
    } catch (e) {
      this.toast.error((e as Error)?.message || this.i18n.t('No se pudo crear la actividad.'));
    } finally {
      this.creando.set(false);
    }
  }

  cerrarSheets(): void {
    this.asignando.set(null);
    this.cancelando.set(null);
    this.nuevaAbierta.set(false);
  }

  private hoyLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  back(): void {
    this.location.back();
  }
}
