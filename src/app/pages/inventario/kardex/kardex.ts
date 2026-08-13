import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { InventarioService, Kardex, KardexMovimiento } from '../../../core/services/inventario.service';

type TipoFiltro = 'todos' | 'entrada' | 'salida' | 'ajuste';

/** Un punto de la curva del timeline, ya escalado al viewBox del SVG. */
interface PuntoCurva {
  x: number;
  y: number;
}

/**
 * AP3 — Kardex por artículo×almacén (el sketch de Xaviel): tabla de movimientos
 * (Mov|Origen|Destino|Fecha|Entrega|Recibe|Transporte|Conduce) + timeline del stock
 * + filtros (tipo, transportista, quien entrega, fechas). Cada movimiento con conduce
 * abre su detalle (fotos/firmas). El dato de apertura (AP5) es la BASE de la curva,
 * no un movimiento: nunca aparece como fila ni como "bajón".
 */
@Component({
  selector: 'app-kardex',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, DecimalPipe, LiveRefreshDirective],
  templateUrl: './kardex.html',
  styleUrl: './kardex.scss',
})
export class KardexPage {
  private inventario = inject(InventarioService);
  private location = inject(Location);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private bodegaId = this.route.snapshot.paramMap.get('bodegaId') ?? '';
  private articuloId = this.route.snapshot.paramMap.get('articuloId') ?? '';

  articuloNombre = signal('');
  bodegaNombre = signal('');
  kardex = signal<Kardex | null>(null);
  loading = signal(false);

  // Filtros (todos client-side: recortan la lista, no la serie del timeline).
  tipo = signal<TipoFiltro>('todos');
  transportista = signal<string>('');
  entrega = signal<string>('');
  desde = signal<string>('');
  hasta = signal<string>('');

  private movimientos = computed(() => this.kardex()?.movimientos ?? []);

  /** Opciones de filtro derivadas de los propios movimientos (sin RPC extra). */
  transportistas = computed(() =>
    [...new Set(this.movimientos().map((m) => m.transporte_nombre).filter((v): v is string => !!v))].sort(),
  );
  entregadores = computed(() =>
    [...new Set(this.movimientos().map((m) => m.entrega_nombre).filter((v): v is string => !!v))].sort(),
  );

  movsFiltrados = computed<KardexMovimiento[]>(() => {
    const t = this.tipo();
    const tr = this.transportista();
    const en = this.entrega();
    const d = this.desde();
    const h = this.hasta();
    return this.movimientos().filter((m) => {
      if (t !== 'todos' && m.mov !== t) return false;
      if (tr && m.transporte_nombre !== tr) return false;
      if (en && m.entrega_nombre !== en) return false;
      if (d && m.fecha < d) return false;
      if (h && m.fecha > h) return false;
      return true;
    });
  });

  hayFiltro = computed(
    () => this.tipo() !== 'todos' || !!this.transportista() || !!this.entrega() || !!this.desde() || !!this.hasta(),
  );

  apertura = computed(() => this.kardex()?.apertura ?? 0);
  saldoActual = computed(() => this.kardex()?.saldo_actual ?? 0);

  // ── Timeline del stock (sparkline SVG) ───────────────────────────────────────
  readonly vbW = 320;
  readonly vbH = 70;

  private serie = computed(() => this.kardex()?.serie ?? []);

  curva = computed<PuntoCurva[]>(() => {
    const s = this.serie();
    const base = this.apertura();
    // Puntos = apertura (base) + cada saldo tras un movimiento.
    const saldos = [base, ...s.map((p) => p.saldo)];
    if (saldos.length === 1) return [{ x: 0, y: this.vbH / 2 }, { x: this.vbW, y: this.vbH / 2 }];
    const min = Math.min(...saldos);
    const max = Math.max(...saldos);
    const span = max - min || 1;
    const pad = 6;
    const usableH = this.vbH - pad * 2;
    const n = saldos.length;
    return saldos.map((v, i) => ({
      x: (i / (n - 1)) * this.vbW,
      y: pad + (1 - (v - min) / span) * usableH,
    }));
  });

  curvaPath = computed(() => this.curva().map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
  curvaArea = computed(() => {
    const pts = this.curva();
    if (!pts.length) return '';
    const line = pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
    return `M${line} L${this.vbW} ${this.vbH} L0 ${this.vbH} Z`;
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    // Nombre del artículo y del almacén (best-effort, para el encabezado).
    void this.inventario.getArticulo(this.articuloId).then((a) => a && this.articuloNombre.set(a.nombre));
    void this.inventario.getBodegas().then((bs) => {
      const b = bs.find((x) => x.id === this.bodegaId);
      if (b) this.bodegaNombre.set(b.nombre);
    });
    await this.load();
  }

  async load(silent = false): Promise<void> {
    if (!this.articuloId || !this.bodegaId) return;
    if (!silent) this.loading.set(true);
    try {
      this.kardex.set(await this.inventario.kardexArticulo(this.articuloId, this.bodegaId));
    } catch {
      this.kardex.set({ apertura: 0, saldo_actual: 0, serie: [], movimientos: [] });
    } finally {
      this.loading.set(false);
    }
  }

  onRefresh = (silent = false): void => {
    void this.load(silent);
  };

  limpiarFiltros(): void {
    this.tipo.set('todos');
    this.transportista.set('');
    this.entrega.set('');
    this.desde.set('');
    this.hasta.set('');
  }

  /** AP3 — el movimiento abre su conduce (detalle con fotos/firmas), si lo tiene. */
  verConduce(m: KardexMovimiento): void {
    if (!m.conduce_id) return;
    void this.router.navigate(['/transporte/conduce-detalle', m.conduce_id]);
  }

  movLabel(m: KardexMovimiento): string {
    return m.mov === 'entrada' ? 'Entrada' : m.mov === 'salida' ? 'Salida' : 'Ajuste';
  }

  /** Fecha + hora en 12h (RD) para las filas. */
  fechaHora(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString('es-DO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  back(): void {
    this.location.back();
  }
}
