import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TrayectoriaMap } from '../../../shared/ui/trayectoria-map/trayectoria-map';
import { RecorridoService, RecorridoDia } from '../../../core/services/recorrido.service';
import { TrackingService } from '../../../core/services/tracking.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';

interface DiaChip {
  fecha: string; // YYYY-MM-DD
  label: string;
}

/**
 * AU7 — "Mi recorrido" del chofer (estilo Google Timeline): el recorrido del día
 * dibujado (aunque parte se haya hecho sin internet) + las paradas detectadas con
 * horas. Consume recorrido_diario_de(miId, fecha). Muestra un indicador sutil de
 * "N puntos por sincronizar" (buffer offline aún sin subir).
 */
@Component({
  selector: 'app-mi-recorrido',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, TrayectoriaMap],
  templateUrl: './mi-recorrido.html',
  styleUrl: './mi-recorrido.scss',
})
export class MiRecorridoPage {
  private recorrido = inject(RecorridoService);
  private tracking = inject(TrackingService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  loading = signal(true);
  data = signal<RecorridoDia | null>(null);
  fechaSel = signal('');

  readonly dias: DiaChip[] = this.buildDias();
  readonly hoy = this.dias[0].fecha;

  coords = computed<[number, number][]>(() => this.data()?.coords ?? []);
  paradas = computed(() => this.data()?.paradas ?? []);
  tienePuntos = computed(() => this.coords().length > 0);
  esHoy = computed(() => this.fechaSel() === this.hoy);
  pendientes = this.tracking.pendientesSync; // AU7 — N puntos por sincronizar

  constructor() {
    this.fechaSel.set(this.hoy);
    void this.load();
  }

  private buildDias(): DiaChip[] {
    const out: DiaChip[] = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const fecha = this.toISODate(d);
      const label = i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric' });
      out.push({ fecha, label });
    }
    return out;
  }

  private toISODate(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  seleccionar(fecha: string): void {
    if (fecha === this.fechaSel()) return;
    this.fechaSel.set(fecha);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.recorrido.recorridoDia(this.fechaSel()));
    } catch {
      this.toast.error('No pudimos cargar tu recorrido.');
      this.data.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  hhmm(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'p.m.' : 'a.m.';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  sincronizar(): void {
    // Fuerza la subida del buffer offline y refresca el recorrido.
    void (async () => {
      this.toast.show('Sincronizando puntos…', 'info');
      await this.tracking.sincronizarAhora();
      await this.load();
    })();
  }

  back(): void {
    this.navGuard.back('/transporte');
  }
}
