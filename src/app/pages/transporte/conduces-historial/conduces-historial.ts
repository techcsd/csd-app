import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConducesService, ConduceHistorial } from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';

const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En tránsito',
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
  imports: [FormsModule, DatePipe, DecimalPipe, Skeleton, EmptyState, SyncBar, CollapsibleSelect],
  templateUrl: './conduces-historial.html',
  styleUrl: './conduces-historial.scss',
})
export class ConducesHistorialPage {
  private service = inject(ConducesService);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  loading = signal(true);
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

  readonly fases = Object.keys(FASE_LABEL);

  lista = computed(() => {
    const f = this.faseFiltro();
    const todos = this.todos();
    return f ? todos.filter((c) => c.fase === f) : todos;
  });

  faseLabel(f: string | null): string {
    return f ? (FASE_LABEL[f] ?? f) : '—';
  }
  faseTint(f: string | null): string {
    return f ? (FASE_TINT[f] ?? '#6b7280') : '#6b7280';
  }

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.service.misConducesHistorial({
        desde: this.desde() || null,
        hasta: this.hasta() || null,
      });
      this.todos.set(data);
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.expandido.update((cur) => (cur === id ? null : id));
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
