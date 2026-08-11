import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { Img } from '../../shared/ui/img/img';
import { TecnologiaService } from '../../core/services/tecnologia.service';
import { TecEquipo, TecTipo, TEC_ESTADO_LABEL, TecEstado } from '../../core/models/tecnologia.model';
import { ToastService } from '../../core/services/toast.service';

/**
 * AL2 — Inventario tecnológico (listado). Buscador + filtros (tipo, estado),
 * portada por equipo, tap → detalle, FAB → alta por hojas. Módulo Tecnología
 * (gating admin | módulo tecnologia).
 */
@Component({
  selector: 'app-tecnologia-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, Img],
  templateUrl: './tecnologia-inventario.html',
  styleUrl: './tecnologia-inventario.scss',
})
export class TecnologiaInventarioPage {
  private tec = inject(TecnologiaService);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);

  readonly estadoLabel = TEC_ESTADO_LABEL;

  loading = signal(true);
  equipos = signal<TecEquipo[]>([]);
  tipos = signal<TecTipo[]>([]);
  portadas = signal<Record<string, string>>({});

  busqueda = signal('');
  tipoFiltro = signal('');
  estadoFiltro = signal('');

  tipoOptions = computed(() => [
    { id: '', label: 'Todos los tipos' },
    ...this.tipos().map((t) => ({ id: t.id, label: t.label })),
  ]);
  estadoOptions = computed(() => [
    { id: '', label: 'Todos los estados' },
    ...(Object.entries(TEC_ESTADO_LABEL).map(([id, label]) => ({ id, label }))),
  ]);

  tipoLabel(id: string | null): string {
    return this.tipos().find((t) => t.id === id)?.label ?? '—';
  }

  filtrados = computed<TecEquipo[]>(() => {
    const q = this.busqueda().trim().toLowerCase();
    const tf = this.tipoFiltro();
    const ef = this.estadoFiltro();
    return this.equipos().filter((e) => {
      if (tf && e.tipo_id !== tf) return false;
      if (ef && e.estado !== ef) return false;
      if (!q) return true;
      return `${e.nombre} ${e.codigo ?? ''} ${e.marca ?? ''} ${e.modelo ?? ''} ${e.serie ?? ''}`.toLowerCase().includes(q);
    });
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [eq, tipos] = await Promise.all([this.tec.getEquipos(), this.tec.getTipos()]);
      this.equipos.set(eq);
      this.tipos.set(tipos);
      void this.resolverPortadas(eq);
    } catch {
      this.toast.error('No pudimos cargar el inventario tecnológico.');
    } finally {
      this.loading.set(false);
    }
  }

  private async resolverPortadas(eq: TecEquipo[]): Promise<void> {
    const map: Record<string, string> = {};
    for (const e of eq) {
      const path = e.foto_portada || e.fotos?.[0] || e.foto_path;
      const url = await this.tec.fotoUrl(path);
      if (url) map[e.id] = url;
    }
    this.portadas.set(map);
  }

  portadaOf(e: TecEquipo): string | null {
    return this.portadas()[e.id] ?? null;
  }
  estadoDe(e: TecEquipo): string {
    return this.estadoLabel[e.estado as TecEstado] ?? e.estado;
  }

  abrir(e: TecEquipo): void {
    void this.router.navigate(['/tecnologia-inventario', e.id]);
  }
  nuevo(): void {
    void this.router.navigate(['/tecnologia-inventario/nuevo']);
  }
  back(): void {
    this.location.back();
  }
}
