import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { StockObraItem, PedidoObra } from '../../../core/models/obra.model';

const ESTADO_META: Record<string, { label: string; tint: string }> = {
  pendiente: { label: 'Pendiente', tint: '#ca8a04' },
  aprobada: { label: 'Aprobada', tint: '#2563eb' },
  despachada: { label: 'Despachada', tint: '#16a34a' },
  cerrada: { label: 'Cerrada', tint: '#16a34a' },
  rechazada: { label: 'Rechazada', tint: '#dc2626' },
};

interface PedidoLinea {
  descripcion: string;
  cantidad: number;
  unidad: string;
}

/** AG16 FASE 3 — Recursos: stock por obra + pedido urgente de material. */
@Component({
  selector: 'app-obra-recursos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Skeleton, EmptyState],
  templateUrl: './recursos.html',
  styleUrl: './recursos.scss',
})
export class RecursosPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);

  proyectoId = '';
  tab = signal<'stock' | 'pedido'>('stock');
  loading = signal(true);
  stock = signal<StockObraItem[]>([]);
  pedidos = signal<PedidoObra[]>([]);

  // Pedido urgente
  lineas = signal<PedidoLinea[]>([]);
  nuevoDesc = signal('');
  nuevaCant = signal(1);
  nuevaUnidad = signal('und');
  notas = signal('');
  enviando = signal(false);

  puedeEnviar = computed(() => this.lineas().length > 0);

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const [stock, pedidos] = await Promise.all([
        this.obra.stockDeObra(this.proyectoId),
        this.obra.misPedidosObra(this.proyectoId),
      ]);
      this.stock.set(stock);
      this.pedidos.set(pedidos);
    } finally {
      this.loading.set(false);
    }
  }

  estadoMeta(e: string | null): { label: string; tint: string } {
    return (e && ESTADO_META[e]) || { label: e ?? '—', tint: '#6b7280' };
  }

  agregarLinea(): void {
    const d = this.nuevoDesc().trim();
    if (!d || this.nuevaCant() <= 0) {
      this.toast.error('Escribe qué necesitas y la cantidad.');
      return;
    }
    this.lineas.update((l) => [...l, { descripcion: d, cantidad: this.nuevaCant(), unidad: this.nuevaUnidad().trim() || 'und' }]);
    this.nuevoDesc.set('');
    this.nuevaCant.set(1);
    this.nuevaUnidad.set('und');
  }
  quitarLinea(i: number): void {
    this.lineas.update((l) => l.filter((_, idx) => idx !== i));
  }

  async enviarPedido(): Promise<void> {
    if (this.enviando() || !this.puedeEnviar()) return;
    this.enviando.set(true);
    try {
      await this.obra.enqueuePedidoUrgente({
        proyectoId: this.proyectoId,
        notas: this.notas().trim(),
        items: this.lineas().map((l) => ({ articulo_id: '', descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad })),
      });
      this.toast.success(this.network.online() ? 'Pedido urgente enviado.' : 'Guardado. Se enviará cuando tengas señal.');
      this.lineas.set([]);
      this.notas.set('');
      void this.obra.misPedidosObra(this.proyectoId).then((p) => this.pedidos.set(p));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el pedido.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/obra');
  }
}
