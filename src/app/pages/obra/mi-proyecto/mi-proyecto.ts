import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ObraService } from '../../../core/services/obra.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { ObraProyecto, ResumenObra } from '../../../core/models/obra.model';
import { BitacoraFull, ProyectoPartida } from '../../../core/models/bitacora.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * BH2 — "Mi proyecto": el resumen que un ingeniero mira en obra, de solo lectura.
 * Agrega RPCs que ya existen (no toca backend): avance real vs plan, mis pendientes
 * (tareas / NC / pedidos), partidas próximas y las últimas bitácoras. Hueco de
 * capacidad de la web construido en la app (alcance mínimo útil primero).
 */
@Component({
  selector: 'app-mi-proyecto',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, CollapsibleSelect, DecimalPipe],
  templateUrl: './mi-proyecto.html',
  styleUrl: './mi-proyecto.scss',
})
export class MiProyectoPage {
  private obra = inject(ObraService);
  private bitacora = inject(BitacoraService);
  private router = inject(Router);
  private location = inject(Location);

  readonly fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  obras = signal<ObraProyecto[]>([]);
  obraSel = signal('');
  resumen = signal<ResumenObra | null>(null);
  partidas = signal<ProyectoPartida[]>([]);
  bitacoras = signal<BitacoraFull[]>([]);

  obraActual = computed(() => this.obras().find((o) => o.id === this.obraSel()) ?? null);
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));

  /** Partidas con trabajo pendiente (ejecutada < planeada), las de mayor faltante. */
  partidasProximas = computed(() =>
    this.partidas()
      .filter((p) => (p.cantidad_planeada ?? 0) > (p.cantidad_ejecutada ?? 0))
      .sort((a, b) => this.faltante(b) - this.faltante(a))
      .slice(0, 6),
  );
  /** Últimas bitácoras de ESTA obra (por nombre de proyecto), o las más recientes. */
  ultimasBitacoras = computed(() => {
    const nom = this.obraActual()?.nombre;
    const all = this.bitacoras();
    const deObra = nom ? all.filter((b) => b.proyecto?.nombre === nom) : all;
    return (deObra.length ? deObra : all).slice(0, 5);
  });

  constructor() {
    void this.load();
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  faltante(p: ProyectoPartida): number {
    return Math.max(0, (p.cantidad_planeada ?? 0) - (p.cantidad_ejecutada ?? 0));
  }
  pctPartida(p: ProyectoPartida): number {
    const plan = p.cantidad_planeada ?? 0;
    if (plan <= 0) return 0;
    return Math.min(100, Math.round(((p.cantidad_ejecutada ?? 0) / plan) * 100));
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const obras = await this.obra.misObras();
      this.obras.set(obras);
      if (!obras.length) {
        this.loading.set(false);
        return;
      }
      this.obraSel.set(obras[0].id);
      await this.cargarObra(obras[0].id);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async cambiarObra(id: string): Promise<void> {
    if (!id || id === this.obraSel()) return;
    this.obraSel.set(id);
    this.loading.set(true);
    try {
      await this.cargarObra(id);
    } finally {
      this.loading.set(false);
    }
  }

  private async cargarObra(id: string): Promise<void> {
    const [resumen, partidas, bitacoras] = await Promise.all([
      this.obra.resumenDelDia(id, this.hoy()).catch(() => null),
      this.bitacora.getPartidas(id).catch(() => [] as ProyectoPartida[]),
      this.bitacora.misBitacoras().catch(() => [] as BitacoraFull[]),
    ]);
    this.resumen.set(resumen);
    this.partidas.set(partidas);
    this.bitacoras.set(bitacoras);
  }

  irAMiObra(): void {
    void this.router.navigate(['/obra']);
  }

  back(): void {
    this.location.back();
  }
}
