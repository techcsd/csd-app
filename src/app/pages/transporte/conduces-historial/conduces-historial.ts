import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService, ConduceHistorial } from '../../../core/services/conduces.service';

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
  imports: [FormsModule, DatePipe, DecimalPipe, Skeleton, EmptyState, SyncBar],
  templateUrl: './conduces-historial.html',
  styleUrl: './conduces-historial.scss',
})
export class ConducesHistorialPage {
  private service = inject(ConducesService);
  private location = inject(Location);

  loading = signal(true);
  todos = signal<ConduceHistorial[]>([]);
  expandido = signal<string | null>(null);

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

  back(): void {
    this.location.back();
  }
}
