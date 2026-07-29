import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe, Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { VersionService, VersionHistorial, CAMBIO_LABEL } from '../../core/services/version.service';
import { ErrorReportService, AppErrorReportRow } from '../../core/services/error-report.service';
import { NetworkService } from '../../core/services/network.service';
import { UserContextService } from '../../core/services/user-context.service';
import { AyudaService } from '../../core/services/ayuda.service';
import { DudaCategoria, GuiaVisual } from '../../core/models/ayuda.model';
import { environment } from '../../../environments/environment';
import { formatFechaMedia } from '../../core/util/fecha';

type Tab = 'versiones' | 'dudas' | 'errores';

// Z30 — mapa de icono corto → emoji para las guías visuales.
const GUIA_ICONO: Record<GuiaVisual['icono'], string> = {
  preuso: '📝',
  combustible: '⛽',
  conduce: '🧾',
  bitacora: '📓',
  inventario: '📦',
};

/**
 * Y11-app — Sección "Tecnología" (gateada por módulo `tecnologia`: admin +
 * Tecnología/Encargado de Tecnología). Muestra: versión instalada + aviso de
 * nueva, historial de versiones de la app (reutiliza `VersionService.historial`,
 * misma fuente que la web) y una vista compacta de reportes de errores (Y6) para
 * diagnóstico en campo (RLS `es_tecnologia()`).
 */
@Component({
  selector: 'app-tecnologia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, JsonPipe],
  templateUrl: './tecnologia.html',
  styleUrl: './tecnologia.scss',
})
export class TecnologiaPage {
  private version = inject(VersionService);
  private errores = inject(ErrorReportService);
  private network = inject(NetworkService);
  private location = inject(Location);
  private ctx = inject(UserContextService);
  private ayuda = inject(AyudaService);

  readonly cambioLabel = CAMBIO_LABEL;
  readonly guiaIcono = GUIA_ICONO;
  readonly instalada = environment.version;

  // Z26 — "Reportes de errores" solo para admin/tecnologia/gerencia/direccion.
  // El resto de Tecnología (Historial de versiones + Dudas) lo ve todo usuario.
  esTecnologia = this.ctx.esTecnologia;

  // Z30 — Dudas (mismo contenido que la web, desde sgc.ayuda_contenido).
  private dudasCargadas = false;
  guias = signal<GuiaVisual[]>([]);
  categorias = signal<DudaCategoria[]>([]);
  dudasQuery = signal('');
  expandidaDuda = signal<string | null>(null);

  private canVerModulo(modulo?: string): boolean {
    if (this.ctx.hasRol('admin')) return true;
    return modulo ? this.ctx.hasModulo(modulo) : true;
  }

  guiasVisibles = computed(() => this.guias().filter((g) => this.canVerModulo(g.modulo)));

  private categoriasVisibles = computed(() =>
    this.categorias().filter((c) => {
      if (this.ctx.hasRol('admin')) return true;
      if (c.soloAdmin) return false;
      return c.modulo ? this.ctx.hasModulo(c.modulo) : true;
    }),
  );

  categoriasFiltradas = computed<DudaCategoria[]>(() => {
    const q = this.dudasQuery().toLowerCase().trim();
    const base = this.categoriasVisibles();
    if (!q) return base;
    return base
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => i.pregunta.toLowerCase().includes(q) || i.respuesta.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
  });

  hayDudas = computed(() => this.guiasVisibles().length > 0 || this.categoriasFiltradas().length > 0);

  tab = signal<Tab>('versiones');
  loading = signal(true);
  historial = signal<VersionHistorial[]>([]);
  reportes = signal<AppErrorReportRow[]>([]);
  private reportesCargados = false;
  private expandido = signal<Set<string>>(new Set());

  /** Solo el historial de la app (plataforma móvil). */
  versionesApp = computed(() => this.historial().filter((v) => v.plataforma === 'movil'));

  hayNueva = computed(() => this.version.hayNueva());
  publicada = computed(() => this.version.info()?.version_publicada ?? null);

  constructor() {
    void this.loadVersiones();
    void this.version.check();
  }

  get online(): boolean {
    return this.network.online();
  }

  setTab(t: Tab): void {
    // Z26 — un usuario sin rol de Tecnología no puede abrir "Reportes de errores".
    if (t === 'errores' && !this.esTecnologia()) return;
    this.tab.set(t);
    if (t === 'errores' && !this.reportesCargados) void this.loadReportes();
    if (t === 'dudas' && !this.dudasCargadas) void this.loadDudas();
  }

  private async loadDudas(): Promise<void> {
    this.dudasCargadas = true;
    this.loading.set(true);
    try {
      const { guias, categorias } = await this.ayuda.getContenido();
      this.guias.set(guias);
      this.categorias.set(categorias);
    } finally {
      this.loading.set(false);
    }
  }

  toggleDuda(key: string): void {
    this.expandidaDuda.update((cur) => (cur === key ? null : key));
  }
  dudaAbierta(key: string): boolean {
    return this.expandidaDuda() === key;
  }

  private async loadVersiones(): Promise<void> {
    this.loading.set(true);
    try {
      this.historial.set(await this.version.historial());
    } catch {
      this.historial.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadReportes(): Promise<void> {
    this.reportesCargados = true;
    this.loading.set(true);
    try {
      this.reportes.set(await this.errores.listRecent(100));
    } finally {
      this.loading.set(false);
    }
  }

  abierto(id: string): boolean {
    return this.expandido().has(id);
  }
  toggle(id: string): void {
    this.expandido.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  dispositivo(r: AppErrorReportRow): string {
    return [r.device_brand, r.device_model].filter(Boolean).join(' ') || 'Dispositivo';
  }

  ruta(r: AppErrorReportRow): string {
    const ctx = r.context ?? {};
    return typeof ctx['route'] === 'string' ? (ctx['route'] as string) : '';
  }

  fmtFecha(iso: string | null): string {
    return iso ? formatFechaMedia(iso) : '—';
  }

  back(): void {
    this.location.back();
  }
}
