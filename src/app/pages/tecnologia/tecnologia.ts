import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { JsonPipe, Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { VersionService, VersionHistorial, CAMBIO_LABEL } from '../../core/services/version.service';
import { ErrorReportService, AppErrorReportRow } from '../../core/services/error-report.service';
import { NetworkService } from '../../core/services/network.service';
import { environment } from '../../../environments/environment';
import { formatFechaMedia } from '../../core/util/fecha';

type Tab = 'versiones' | 'errores';

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
  imports: [Skeleton, EmptyState, JsonPipe],
  templateUrl: './tecnologia.html',
  styleUrl: './tecnologia.scss',
})
export class TecnologiaPage {
  private version = inject(VersionService);
  private errores = inject(ErrorReportService);
  private network = inject(NetworkService);
  private location = inject(Location);

  readonly cambioLabel = CAMBIO_LABEL;
  readonly instalada = environment.version;

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
    this.tab.set(t);
    if (t === 'errores' && !this.reportesCargados) void this.loadReportes();
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
