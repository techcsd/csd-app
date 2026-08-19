import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../shared/ui/photo-slot/photo-slot';
import { ProyectosService, CompraProyecto, GastoCategoria, GastoDirecto } from '../../core/services/proyectos.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ToastService } from '../../core/services/toast.service';
import { NetworkService } from '../../core/services/network.service';
import { CapturedPhoto } from '../../core/services/camera.service';

type Tab = 'compras' | 'gastos';

/**
 * AH15 — consulta de "Compras del proyecto" (órdenes de compra + ferretería) para
 * roles con acceso al proyecto (gerente de producción, compras, proyectos, admin).
 * Read-only; el RPC `compras_de_proyecto` aplica permisos + es_prueba server-side.
 */
@Component({
  selector: 'app-compras-proyecto',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, DecimalPipe, Skeleton, EmptyState, CollapsibleSelect, SyncBar, PhotoSlot],
  templateUrl: './compras-proyecto.html',
  styleUrl: './compras-proyecto.scss',
})
export class ComprasProyectoPage {
  private proyectos = inject(ProyectosService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private network = inject(NetworkService);
  private route = inject(ActivatedRoute);

  loadingObras = signal(true);
  loading = signal(false);
  obraOpts = signal<{ id: string; label: string }[]>([]);
  proyectoId = signal('');
  desde = signal('');
  hasta = signal('');
  compras = signal<CompraProyecto[]>([]);

  total = computed(() => this.compras().reduce((s, c) => s + (c.total ?? 0), 0));

  // AS14 — gastos directos (fuera de requisición).
  tab = signal<Tab>('compras');
  gastos = signal<GastoDirecto[]>([]);
  cargandoGastos = signal(false);
  categorias = signal<GastoCategoria[]>([]);
  puedeRegistrar = signal(false);
  totalGastos = computed(() => this.gastos().reduce((s, g) => s + (g.monto ?? 0), 0));

  // Form de nuevo gasto.
  gastoForm = signal(false);
  gCategoria = signal('');
  gConcepto = signal('');
  gMonto = signal<number | null>(null);
  gFecha = signal('');
  gRecibo = signal<CapturedPhoto | null>(null);
  guardandoGasto = signal(false);

  constructor() {
    void this.cargarObras();
    void this.proyectos.getGastoCategorias().then((c) => this.categorias.set(c)).catch(() => {});
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'gastos' && this.proyectoId()) void this.cargarGastos();
  }

  private async cargarObras(): Promise<void> {
    this.loadingObras.set(true);
    try {
      // QA-17: usa el RPC de obras elegibles (incluye compras/obra, que la RLS
      // directa de `proyectos` excluye) en vez del listado completo del módulo.
      const ps = await this.proyectos.getProyectosPickables();
      this.obraOpts.set(ps.map((p) => ({ id: p.id, label: p.nombre })));
      // AS24 — preselecciona por ?obra= (viene del detalle del proyecto) o la obra activa.
      const preId = this.route.snapshot.queryParamMap.get('obra') ?? this.ctx.obraActiva()?.id ?? null;
      if (preId && ps.some((p) => p.id === preId)) {
        this.onObra(preId);
      }
    } finally {
      this.loadingObras.set(false);
    }
  }

  onObra(id: string): void {
    this.proyectoId.set(id);
    void this.cargar();
    // AS14 — permiso + gastos de la obra elegida.
    void this.proyectos.puedeRegistrarGasto(id).then((v) => this.puedeRegistrar.set(v));
    if (this.tab() === 'gastos') void this.cargarGastos();
  }

  async cargarGastos(): Promise<void> {
    if (!this.proyectoId()) return;
    this.cargandoGastos.set(true);
    try {
      this.gastos.set(
        await this.proyectos.gastosDirectos(this.proyectoId(), this.desde() || null, this.hasta() || null),
      );
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los gastos.');
    } finally {
      this.cargandoGastos.set(false);
    }
  }

  // AS14 — DECISIÓN (Xaviel, 23/08/2026): el gasto directo es ONLINE-ONLY A PROPÓSITO.
  // Es DINERO: preferimos exigir conexión y confirmar contra el server en el momento
  // antes que dejar montos "flotando" sin confirmar en el outbox (un monto encolado
  // que el usuario cree registrado pero aún no subió es peor que pedir internet). Es
  // la ÚNICA excepción consciente a ADR-002 (todo write por outbox); documentada aquí
  // para que futuras auditorías no lo marquen como bug. El resto de la app sí es offline.
  abrirFormGasto(): void {
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para registrar un gasto.');
      return;
    }
    this.gCategoria.set(this.categorias()[0]?.clave ?? 'misc');
    this.gConcepto.set('');
    this.gMonto.set(null);
    this.gFecha.set('');
    this.gRecibo.set(null);
    this.gastoForm.set(true);
  }

  async guardarGasto(): Promise<void> {
    if (this.guardandoGasto()) return;
    if (!this.gConcepto().trim()) {
      this.toast.error('Escribe el concepto del gasto.');
      return;
    }
    if (!this.gMonto() || this.gMonto()! <= 0) {
      this.toast.error('El monto debe ser mayor que cero.');
      return;
    }
    this.guardandoGasto.set(true);
    try {
      await this.proyectos.registrarGastoDirecto({
        proyectoId: this.proyectoId(),
        categoria: this.gCategoria(),
        concepto: this.gConcepto().trim(),
        monto: this.gMonto()!,
        fecha: this.gFecha() || null,
        recibo: this.gRecibo()?.blob ?? null,
      });
      this.toast.success('Gasto registrado.');
      this.gastoForm.set(false);
      await this.cargarGastos();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar el gasto.');
    } finally {
      this.guardandoGasto.set(false);
    }
  }

  categoriaLabel(clave: string): string {
    return this.categorias().find((c) => c.clave === clave)?.label ?? clave;
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
