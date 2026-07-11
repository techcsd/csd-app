import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { AdminService, AuditoriaRow } from '../../../core/services/admin.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

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
  imports: [Skeleton, DatePipe],
  templateUrl: './auditoria.html',
  styleUrl: './auditoria.scss',
})
export class AdminAuditoriaPage {
  private admin = inject(AdminService);
  private location = inject(Location);

  rows = signal<AuditoriaRow[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  error = signal('');
  page = signal(0);
  canLoadMore = signal(true);
  expandedId = signal<number | null>(null);
  fAccion = signal('');

  constructor() {
    void this.load(true);
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
