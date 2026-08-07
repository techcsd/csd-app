import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { ProyectosService, CompraProyecto } from '../../core/services/proyectos.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * AH15 — consulta de "Compras del proyecto" (órdenes de compra + ferretería) para
 * roles con acceso al proyecto (gerente de producción, compras, proyectos, admin).
 * Read-only; el RPC `compras_de_proyecto` aplica permisos + es_prueba server-side.
 */
@Component({
  selector: 'app-compras-proyecto',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, DecimalPipe, Skeleton, EmptyState, CollapsibleSelect, SyncBar],
  templateUrl: './compras-proyecto.html',
  styleUrl: './compras-proyecto.scss',
})
export class ComprasProyectoPage {
  private proyectos = inject(ProyectosService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);

  loadingObras = signal(true);
  loading = signal(false);
  obraOpts = signal<{ id: string; label: string }[]>([]);
  proyectoId = signal('');
  desde = signal('');
  hasta = signal('');
  compras = signal<CompraProyecto[]>([]);

  total = computed(() => this.compras().reduce((s, c) => s + (c.total ?? 0), 0));

  constructor() {
    void this.cargarObras();
  }

  private async cargarObras(): Promise<void> {
    this.loadingObras.set(true);
    try {
      const ps = await this.proyectos.getProyectos();
      this.obraOpts.set(ps.map((p) => ({ id: p.id, label: p.nombre })));
      // Preselecciona la obra activa del contexto si aplica.
      const activaId = this.ctx.obraActiva()?.id ?? null;
      if (activaId && ps.some((p) => p.id === activaId)) {
        this.proyectoId.set(activaId);
        void this.cargar();
      }
    } finally {
      this.loadingObras.set(false);
    }
  }

  onObra(id: string): void {
    this.proyectoId.set(id);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    if (!this.proyectoId()) return;
    this.loading.set(true);
    try {
      this.compras.set(
        await this.proyectos.comprasDeProyecto(this.proyectoId(), this.desde() || null, this.hasta() || null),
      );
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las compras.');
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string): string {
    return t === 'orden_compra' ? 'Orden de compra' : 'Ferretería';
  }
  tipoIcon(t: string): string {
    return t === 'orden_compra' ? '📄' : '🧾';
  }

  back(): void {
    this.location.back();
  }
}
