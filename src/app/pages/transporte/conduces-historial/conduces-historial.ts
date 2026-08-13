import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, ConduceHistorial } from '../../../core/services/conduces.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';

type RolFiltro = '' | 'emisor' | 'chofer' | 'receptor';

const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En ruta',
  entregado: 'Entregado',
  confirmado: 'Confirmado',
  pendiente_firma: 'Pendiente de firma',
};
const FASE_TINT: Record<string, string> = {
  emitido: '#6b7280',
  en_transito: '#2563eb',
  entregado: '#ca8a04',
  confirmado: '#16a34a',
  pendiente_firma: '#dc2626',
};

/** AF29 — Historial de conduces: listado filtrable (fecha/obra/fase) + detalle. */
@Component({
  selector: 'app-conduces-historial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, DecimalPipe, Skeleton, EmptyState, SyncBar, CollapsibleSelect, LiveRefreshDirective],
  templateUrl: './conduces-historial.html',
  styleUrl: './conduces-historial.scss',
})
export class ConducesHistorialPage {
  private service = inject(ConducesService);
  private inventario = inject(InventarioService);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  loading = signal(true);
  refrescando = signal(false);
  todos = signal<ConduceHistorial[]>([]);
  expandido = signal<string | null>(null);

  // AH5 — transferencia de responsabilidad a otro chofer.
  choferes = signal<{ id: string; label: string }[]>([]);
  transferAbierto = signal<string | null>(null); // salida_id con el form abierto
  choferSel = signal('');
  notaTransfer = signal('');
  transfiriendo = signal(false);

  // Filtros
  desde = signal<string>('');
  hasta = signal<string>('');
  faseFiltro = signal<string>('');
  // AP4 — obra (origen/destino distinguibles), mi rol y buscador.
  obras = signal<{ id: string; label: string }[]>([]);
  obraOrigen = signal<string>('');
  obraDestino = signal<string>('');
  rol = signal<RolFiltro>('');
  query = signal<string>('');
  filtrosAbiertos = signal(false);

  readonly fases = Object.keys(FASE_LABEL);

  /** Opciones para los selectores de obra (con "Todas" al inicio). */
  obraOpciones = computed(() => [{ id: '', label: 'Todas las obras' }, ...this.obras()]);

  hayFiltroAvanzado = computed(
    () => !!this.obraOrigen() || !!this.obraDestino() || !!this.rol() || !!this.desde() || !!this.hasta(),
  );

  lista = computed(() => {
    const f = this.faseFiltro();
    const q = this.query().toLowerCase().trim();
    let out = this.todos();
    if (f) out = out.filter((c) => c.fase === f);
    if (q) {
      out = out.filter(
        (c) =>
          (c.obra ?? '').toLowerCase().includes(q) ||
          (c.origen_proyecto ?? '').toLowerCase().includes(q) ||
          (c.bodega ?? '').toLowerCase().includes(q) ||
          (c.receptor ?? '').toLowerCase().includes(q) ||
          (c.observaciones ?? '').toLowerCase().includes(q),
      );
    }
    return out;
  });

  faseLabel(f: string | null): string {
    return f ? (FASE_LABEL[f] ?? f) : '—';
  }
  faseTint(f: string | null): string {
    return f ? (FASE_TINT[f] ?? '#6b7280') : '#6b7280';
  }

  constructor() {
    void this.cargar();
    void this.inventario
      .getObrasDestino()
      .then((os) => this.obras.set(os.map((o) => ({ id: o.id, label: o.nombre }))))
      .catch(() => {});
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      const data = await this.service.misConducesHistorial({
        desde: this.desde() || null,
        hasta: this.hasta() || null,
        obraOrigen: this.obraOrigen() || null,
        obraDestino: this.obraDestino() || null,
        rol: this.rol() || null,
      });
      this.todos.set(data);
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AP4 — cambios de filtros server-side → recargar. */
  onObraOrigen(id: string): void {
    this.obraOrigen.set(id);
    void this.cargar();
  }
  onObraDestino(id: string): void {
    this.obraDestino.set(id);
    void this.cargar();
  }
  setRol(r: RolFiltro): void {
    this.rol.set(this.rol() === r ? '' : r);
    void this.cargar();
  }
  limpiarFiltros(): void {
    this.obraOrigen.set('');
    this.obraDestino.set('');
    this.rol.set('');
    this.desde.set('');
    this.hasta.set('');
    void this.cargar();
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.cargar(silent);
  }

  toggle(id: string): void {
    this.expandido.update((cur) => (cur === id ? null : id));
  }

  /** AL9/AL4 — abrir el documento del conduce (detalle + Ver conduce/PDF). */
  verConduce(id: string): void {
    void this.router.navigate(['/transporte/conduce-detalle', id]);
  }

  // ─── AH5 — transferir la responsabilidad de un conduce a otro chofer ────────

  /** Solo mientras el chofer AÚN tiene el material (emitido / en tránsito). */
  puedeTransferir(c: ConduceHistorial): boolean {
    return !c.confirmado && (c.fase === 'emitido' || c.fase === 'en_transito');
  }

  async abrirTransferir(c: ConduceHistorial): Promise<void> {
    if (this.transferAbierto() === c.id) {
      this.transferAbierto.set(null);
      return;
    }
    this.choferSel.set('');
    this.notaTransfer.set('');
    this.transferAbierto.set(c.id);
    if (!this.choferes().length) {
      this.choferes.set(await this.service.choferesParaTransferir().catch(() => []));
    }
  }

  async ofrecerTransferencia(c: ConduceHistorial): Promise<void> {
    if (!this.choferSel()) {
      this.toast.error('Elige el chofer al que transfieres.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para ofrecer una transferencia.');
      return;
    }
    this.transfiriendo.set(true);
    try {
      await this.service.ofrecerTransferencia(c.id, this.choferSel(), this.notaTransfer().trim() || null);
      this.toast.success('Transferencia ofrecida. El chofer la verá para aceptarla con foto y firma.');
      this.transferAbierto.set(null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo ofrecer la transferencia.');
    } finally {
      this.transfiriendo.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
