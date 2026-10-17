import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import {
  AdminService,
  AuditoriaActividadFila,
  AuditoriaActividadFiltros,
  AuditoriaResumen,
  AuditoriaRow,
  AuditoriaUsuario,
} from '../../../core/services/admin.service';
import { NetworkService } from '../../../core/services/network.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { formatFechaHumana, formatHora, etiquetaDiaChat, esOtroDia, fechaLocalISO } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';
import { I18nService } from '../../../core/i18n/i18n.service';

interface Barra {
  label: string;
  value: number;
  pct: number;
}

const TABLA_LABELS: Record<string, string> = {
  salidas_inventario: 'Salida de inventario',
  detalle_salidas: 'Renglón de salida',
  entradas_inventario: 'Entrada de inventario',
  detalle_entradas: 'Renglón de entrada',
  articulos: 'Artículo',
  bodegas: 'Bodega',
  conteos_inventario: 'Conteo',
  conteo_items: 'Renglón de conteo',
  unidades: 'Unidad de medida',
  bitacoras: 'Bitácora',
  bitacora_archivos: 'Archivo de bitácora',
  bitacora_catalogos: 'Catálogo de bitácora',
  solicitudes_material: 'Solicitud de material',
  vehiculos: 'Vehículo',
  vehiculo_entregas: 'Entrega de vehículo',
  conductores: 'Conductor',
  usuarios: 'Usuario',
  usuarios_roles: 'Rol de usuario',
  proyectos: 'Proyecto',
  empleados: 'Empleado',
  ordenes_compra: 'Orden de compra',
  proveedores: 'Proveedor',
};

const ACCION_LABELS: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
};

/** Admin → Auditoría (mobile): the change trail, who did what and when. */
@Component({
  selector: 'app-admin-auditoria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, DecimalPipe, TranslatePipe, BottomSheet, ...MOTION_DIRECTIVES],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
})
export class AdminAuditoriaPage {
  private admin = inject(AdminService);
  private network = inject(NetworkService);
  private location = inject(Location);
  private i18n = inject(I18nService);

  // CQ3 — Actividad (feed humano, pestaña por defecto) / Panel (KPIs) / Filas (tabla técnica).
  vista = signal<'actividad' | 'panel' | 'filas'>('actividad');
  online = this.network.online;

  rows = signal<AuditoriaRow[]>([]);
  loading = signal(true);
  fmtFecha = formatFechaHumana; // U9
  loadingMore = signal(false);
  error = signal('');
  page = signal(0);
  canLoadMore = signal(true);
  expandedId = signal<number | null>(null);
  fAccion = signal('');
  private rowsCargadas = false;

  // P13 — panel analítico.
  readonly periodos = [
    { label: '7 días', dias: 7 },
    { label: '30 días', dias: 30 },
    { label: '90 días', dias: 90 },
    { label: 'Todo', dias: 0 },
  ];
  periodoDias = signal(30);
  resumen = signal<AuditoriaResumen | null>(null);
  loadingResumen = signal(true);
  resumenError = signal('');

  usuariosTop = computed(() => this.toBarras(this.resumen()?.por_usuario ?? [], (u) => u.nombre || 'Sistema'));
  porAccion = computed(() => this.toBarras(this.resumen()?.por_accion ?? [], (a) => this.accionLabel(a.accion)));
  porModulo = computed(() => this.toBarras(this.resumen()?.por_modulo ?? [], (m) => this.tablaLabel(m.tabla)));
  porDia = computed(() => this.toBarras(this.resumen()?.por_dia ?? [], (d) => d.dia.slice(5)));
  porHora = computed(() => this.toBarras(this.resumen()?.por_hora ?? [], (h) => `${h.hora}h`));

  // ── CQ3 — Actividad (feed humano) ───────────────────────────
  actFilas = signal<AuditoriaActividadFila[]>([]);
  actLoading = signal(true);
  actLoadingMore = signal(false);
  actError = signal('');
  actCursor = signal<string | null>(null);
  actHayMas = signal(true);
  private actCargada = false;

  actTexto = signal('');
  actAccion = signal('');
  readonly actPeriodos = [
    { label: 'Hoy', dias: 1 },
    { label: '7 días', dias: 7 },
    { label: '30 días', dias: 30 },
    { label: 'Todo', dias: 0 },
  ];
  actPeriodoDias = signal(0);

  actPersonaTerm = signal('');
  actPersonaBuscando = signal(false);
  actPersonaResultados = signal<AuditoriaUsuario[]>([]);
  actPersonaSel = signal<AuditoriaUsuario | null>(null);
  private actPersonaDebounce: ReturnType<typeof setTimeout> | null = null;
  private actTextoDebounce: ReturnType<typeof setTimeout> | null = null;

  fmtHora = formatHora; // CQ3 — hora corta en el feed.
  actEtiquetaDia = etiquetaDiaChat; // CQ3 — "Hoy"/"Ayer"/fecha del separador de día.

  // Detalle (bottom sheet) + "ver historia del registro".
  actSheetOpen = signal(false);
  actSheetFila = signal<AuditoriaActividadFila | null>(null);
  actHistoria = signal<AuditoriaActividadFila[]>([]);
  actHistoriaLoading = signal(false);
  actHistoriaError = signal('');
  private actHistoriaCargadaFor: string | null = null;

  constructor() {
    void this.loadResumen();
    void this.loadActividad(true);
  }

  cambiarVista(v: 'actividad' | 'panel' | 'filas'): void {
    this.vista.set(v);
    if (v === 'filas' && !this.rowsCargadas) void this.load(true);
    if (v === 'actividad' && !this.actCargada) void this.loadActividad(true);
  }

  setPeriodo(dias: number): void {
    this.periodoDias.set(dias);
    void this.loadResumen();
  }

  private desdeIso(): string | null {
    const dias = this.periodoDias();
    if (!dias) return null;
    const d = new Date(Date.now() - dias * 86400000);
    return d.toISOString().slice(0, 10);
  }

  async loadResumen(): Promise<void> {
    this.loadingResumen.set(true);
    this.resumenError.set('');
    try {
      this.resumen.set(await this.admin.getAuditoriaResumen({ desde: this.desdeIso() }));
    } catch (e: unknown) {
      this.resumenError.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar el panel.'));
    } finally {
      this.loadingResumen.set(false);
    }
  }

  /** Convierte una serie {n} en barras con % relativo al máximo (para CSS). */
  private toBarras<T extends { n: number }>(list: T[], label: (x: T) => string): Barra[] {
    const max = list.reduce((m, x) => Math.max(m, x.n), 0) || 1;
    return list.map((x) => ({ label: label(x), value: x.n, pct: Math.round((x.n / max) * 100) }));
  }

  async load(reset = false): Promise<void> {
    if (reset) {
      this.page.set(0);
      this.loading.set(true);
    } else {
      this.loadingMore.set(true);
    }
    this.error.set('');
    try {
      const rows = await this.admin.getAuditoria(this.page(), this.fAccion() || undefined);
      this.canLoadMore.set(rows.length === 30);
      this.rows.update((cur) => (reset ? rows : [...cur, ...rows]));
      this.rowsCargadas = true;
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : this.i18n.t('Error al cargar la auditoría.'));
    } finally {
      this.loading.set(false);
      this.loadingMore.set(false);
    }
  }

  setAccion(a: string): void {
    this.fAccion.set(a);
    void this.load(true);
  }

  loadMore(): void {
    if (this.loadingMore() || !this.canLoadMore()) return;
    this.page.update((p) => p + 1);
    void this.load(false);
  }

  toggle(id: number): void {
    this.expandedId.update((c) => (c === id ? null : id));
  }

  tablaLabel(t: string): string {
    return TABLA_LABELS[t] ?? t;
  }
  accionLabel(a: string): string {
    return ACCION_LABELS[a] ?? a;
  }

  // NB: tipado estructural a propósito — vale tanto para AuditoriaRow (Filas)
  // como para AuditoriaActividadFila (Actividad/historia), que comparten estos
  // campos; así el detalle del feed nuevo reusa exactamente este helper.
  cambiosList(row: { cambios: Record<string, { antes: unknown; despues: unknown }> | null }): { campo: string; antes: string; despues: string }[] {
    if (!row.cambios) return [];
    return Object.entries(row.cambios).map(([campo, v]) => ({
      campo: this.humanize(campo),
      antes: this.fmt(v.antes),
      despues: this.fmt(v.despues),
    }));
  }

  datosList(row: { datos_despues: Record<string, unknown> | null; datos_antes: Record<string, unknown> | null }): { campo: string; valor: string }[] {
    const data = row.datos_despues ?? row.datos_antes;
    if (!data) return [];
    return Object.entries(data)
      .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      .slice(0, 10)
      .map(([campo, v]) => ({ campo: this.humanize(campo), valor: this.fmt(v) }));
  }

  private humanize(c: string): string {
    return c.replace(/_/g, ' ');
  }
  private fmt(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }

  // ── CQ3 — Actividad: carga + filtros ────────────────────────
  private actFiltrosValue(): AuditoriaActividadFiltros {
    const f: AuditoriaActividadFiltros = {};
    const texto = this.actTexto().trim();
    if (texto) f.texto = texto;
    if (this.actAccion()) f.accion = this.actAccion();
    const persona = this.actPersonaSel();
    if (persona) f.persona = persona.id;
    const desde = this.actDesdeIso();
    if (desde) f.desde = desde;
    return f;
  }

  private actDesdeIso(): string | null {
    const dias = this.actPeriodoDias();
    if (!dias) return null;
    if (dias === 1) return fechaLocalISO();
    const d = new Date(Date.now() - dias * 86400000);
    return d.toISOString().slice(0, 10);
  }

  async loadActividad(reset = false): Promise<void> {
    if (reset) {
      this.actCursor.set(null);
      this.actLoading.set(true);
    } else {
      this.actLoadingMore.set(true);
    }
    this.actError.set('');
    try {
      const res = await this.admin.getAuditoriaActividad(this.actFiltrosValue(), reset ? null : this.actCursor(), 40);
      this.actFilas.update((cur) => (reset ? res.filas : [...cur, ...res.filas]));
      this.actCursor.set(res.cursor_siguiente);
      this.actHayMas.set(res.hay_mas);
      this.actCargada = true;
    } catch (e: unknown) {
      this.actError.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar la actividad.'));
    } finally {
      this.actLoading.set(false);
      this.actLoadingMore.set(false);
    }
  }

  actLoadMore(): void {
    if (this.actLoadingMore() || !this.actHayMas()) return;
    void this.loadActividad(false);
  }

  onActTexto(v: string): void {
    this.actTexto.set(v);
    if (this.actTextoDebounce) clearTimeout(this.actTextoDebounce);
    this.actTextoDebounce = setTimeout(() => void this.loadActividad(true), 350);
  }

  setActAccion(a: string): void {
    this.actAccion.set(a);
    void this.loadActividad(true);
  }

  setActPeriodo(dias: number): void {
    this.actPeriodoDias.set(dias);
    void this.loadActividad(true);
  }

  onActPersonaTerm(v: string): void {
    this.actPersonaTerm.set(v);
    if (this.actPersonaDebounce) clearTimeout(this.actPersonaDebounce);
    const t = v.trim();
    if (t.length < 2) {
      this.actPersonaResultados.set([]);
      return;
    }
    this.actPersonaDebounce = setTimeout(() => void this.buscarActPersona(t), 300);
  }

  private async buscarActPersona(t: string): Promise<void> {
    this.actPersonaBuscando.set(true);
    try {
      this.actPersonaResultados.set(await this.admin.buscarUsuarios(t));
    } catch {
      this.actPersonaResultados.set([]);
    } finally {
      this.actPersonaBuscando.set(false);
    }
  }

  elegirActPersona(u: AuditoriaUsuario): void {
    this.actPersonaSel.set(u);
    this.actPersonaResultados.set([]);
    this.actPersonaTerm.set('');
    void this.loadActividad(true);
  }

  limpiarActPersona(): void {
    this.actPersonaSel.set(null);
    void this.loadActividad(true);
  }

  /** CQ3 — true si la fila `i` del feed inicia un día calendario distinto al anterior. */
  actEsNuevoDia(i: number): boolean {
    const list = this.actFilas();
    if (i === 0) return true;
    return esOtroDia(list[i - 1].creado_en, list[i].creado_en);
  }

  /** CQ3 — resalta el `codigo` dentro de `frase_resumen` (si aparece literal). */
  fraseParts(f: AuditoriaActividadFila): { pre: string; codigo: string; post: string } | null {
    if (!f.codigo || !f.frase_resumen.includes(f.codigo)) return null;
    const idx = f.frase_resumen.indexOf(f.codigo);
    return { pre: f.frase_resumen.slice(0, idx), codigo: f.codigo, post: f.frase_resumen.slice(idx + f.codigo.length) };
  }

  // ── CQ3 — detalle (bottom sheet) + historia del registro ────
  abrirDetalleActividad(f: AuditoriaActividadFila): void {
    this.actSheetFila.set(f);
    this.actSheetOpen.set(true);
    this.actHistoria.set([]);
    this.actHistoriaError.set('');
    this.actHistoriaCargadaFor = null;
  }

  cerrarDetalleActividad(): void {
    this.actSheetOpen.set(false);
  }

  async verHistoriaRegistro(): Promise<void> {
    const f = this.actSheetFila();
    if (!f) return;
    const key = `${f.tabla}:${f.registro_id}`;
    if (this.actHistoriaCargadaFor === key) return;
    this.actHistoriaLoading.set(true);
    this.actHistoriaError.set('');
    try {
      this.actHistoria.set(await this.admin.getAuditoriaHistoriaRegistro(f.tabla, f.registro_id));
      this.actHistoriaCargadaFor = key;
    } catch (e: unknown) {
      this.actHistoriaError.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar la historia.'));
    } finally {
      this.actHistoriaLoading.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
