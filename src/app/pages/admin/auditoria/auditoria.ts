import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { AdminService, AuditoriaResumen, AuditoriaRow } from '../../../core/services/admin.service';
import { NetworkService } from '../../../core/services/network.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { formatFechaHumana } from '../../../core/util/fecha';

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
  imports: [Skeleton, DecimalPipe],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
})
export class AdminAuditoriaPage {
  private admin = inject(AdminService);
  private network = inject(NetworkService);
  private location = inject(Location);

  // P13 — vista Panel (KPIs + gráficos) / Filas (tabla de cambios), como la web.
  vista = signal<'panel' | 'filas'>('panel');
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

  constructor() {
    void this.loadResumen();
  }

  cambiarVista(v: 'panel' | 'filas'): void {
    this.vista.set(v);
    if (v === 'filas' && !this.rowsCargadas) void this.load(true);
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
      this.resumenError.set(e instanceof Error ? e.message : 'No se pudo cargar el panel.');
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
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la auditoría.');
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

  cambiosList(row: AuditoriaRow): { campo: string; antes: string; despues: string }[] {
    if (!row.cambios) return [];
    return Object.entries(row.cambios).map(([campo, v]) => ({
      campo: this.humanize(campo),
      antes: this.fmt(v.antes),
      despues: this.fmt(v.despues),
    }));
  }

  datosList(row: AuditoriaRow): { campo: string; valor: string }[] {
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

  back(): void {
    this.location.back();
  }
}
