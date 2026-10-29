import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { EstadoChip } from '../../shared/ui/estado-chip/estado-chip';
import { Img } from '../../shared/ui/img/img';
import { TecnologiaService } from '../../core/services/tecnologia.service';
import { TecEquipo, TecTipo, TecEquipoEstado, TecEquipoCondicion } from '../../core/models/tecnologia.model';
import { tecTonoEstado } from '../../shared/utils/tec-tono.util';
import { ToastService } from '../../core/services/toast.service';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/**
 * AL2/DA — Inventario tecnológico (listado). Buscador + filtros (tipo,
 * situación, condición), portada por equipo, chip de situación + alerta de
 * garantía, tap → detalle, FAB → alta por hojas. `?codigo=TEC-0002` (QR,
 * DA-18) precarga el buscador y abre la ficha si hay un único match exacto.
 */
@Component({
  selector: 'app-tecnologia-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, EstadoChip, Img, ...MOTION_DIRECTIVES],
  templateUrl: './tecnologia-inventario.html',
  styleUrl: './tecnologia-inventario.scss',
})
export class TecnologiaInventarioPage {
  private tec = inject(TecnologiaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private toast = inject(ToastService);

  loading = signal(true);
  equipos = signal<TecEquipo[]>([]);
  tipos = signal<TecTipo[]>([]);
  estados = signal<TecEquipoEstado[]>([]);
  condiciones = signal<TecEquipoCondicion[]>([]);
  portadas = signal<Record<string, string>>({});
  garantiaDias = signal(30);

  busqueda = signal('');
  tipoFiltro = signal('');
  estadoFiltro = signal('');
  condicionFiltro = signal('');

  tipoOptions = computed(() => [
    { id: '', label: 'Todos los tipos' },
    ...this.tipos().map((t) => ({ id: t.id, label: t.label })),
  ]);
  estadoOptions = computed(() => [
    { id: '', label: 'Todas las situaciones' },
    ...this.estados().map((e) => ({ id: e.clave, label: e.label })),
  ]);
  condicionOptions = computed(() => [
    { id: '', label: 'Todas las condiciones' },
    ...this.condiciones().map((c) => ({ id: c.clave, label: c.label })),
  ]);

  tipoLabel(id: string | null): string {
    return this.tipos().find((t) => t.id === id)?.label ?? '—';
  }
  estadoLabel(clave: string): string {
    return this.estados().find((e) => e.clave === clave)?.label ?? clave;
  }

  filtrados = computed<TecEquipo[]>(() => {
    const q = this.busqueda().trim().toLowerCase();
    const tf = this.tipoFiltro();
    const ef = this.estadoFiltro();
    const cf = this.condicionFiltro();
    return this.equipos().filter((e) => {
      if (tf && e.tipo_id !== tf) return false;
      if (ef && e.estado !== ef) return false;
      if (cf && e.condicion !== cf) return false;
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
      const [eq, tipos, estados, condiciones, dias] = await Promise.all([
        this.tec.getEquipos(),
        this.tec.getTipos(),
        this.tec.getEstados(),
        this.tec.getCondiciones(),
        this.tec.getGarantiaAlertaDias(),
      ]);
      this.equipos.set(eq);
      this.tipos.set(tipos);
      this.estados.set(estados);
      this.condiciones.set(condiciones);
      this.garantiaDias.set(dias);
      void this.resolverPortadas(eq);

      // DA-18 — deep-link de QR: ?codigo=TEC-0002 precarga el buscador y, si
      // hay un único match exacto, abre la ficha directo.
      const codigo = this.route.snapshot.queryParamMap.get('codigo');
      if (codigo) {
        this.busqueda.set(codigo);
        const exactos = eq.filter((e) => e.codigo?.toLowerCase() === codigo.toLowerCase());
        if (exactos.length === 1) {
          void this.router.navigate(['/tecnologia-inventario', exactos[0].id], { replaceUrl: true });
        }
      }
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
    return this.estadoLabel(e.estado);
  }
  estadoTonoDe(e: TecEquipo): ReturnType<typeof tecTonoEstado> {
    return tecTonoEstado(e.estado);
  }
  garantiaPorVencer(e: TecEquipo): boolean {
    return this.tec.garantiaPorVencer(e, this.garantiaDias());
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
