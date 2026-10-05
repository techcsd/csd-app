import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, KeyValuePipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  MantenimientosService,
  MantenimientoItem,
  MANTENIMIENTO_TIPO_LABEL,
  MantenimientoTipo,
} from '../../../core/services/mantenimientos.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { MantAdjuntos } from '../../../shared/ui/mant-adjuntos/mant-adjuntos';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFecha } from '../../../core/util/fecha';
import { VehiculoDisponible } from '../../../core/models/transporte.model';

/**
 * CG13 — Módulo de mantenimientos en la app (Raykler / flota; el chofer privado lo ve
 * scopeado por el servidor a su vehículo). Lista GENERAL con filtros (vehículo, tipo,
 * estado, taller, fecha), chips de adjuntos (imagen/PDF) que abren el documento dentro
 * del sistema, y *Nuevo* (elige vehículo → registrar). Crear/cerrar reusan las pantallas
 * por vehículo (AG9). Offline: la lista viene de la caché read-through.
 */
@Component({
  selector: 'app-mantenimientos-general',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, KeyValuePipe, Skeleton, EmptyState, MantAdjuntos, VehiculoPicker, TranslatePipe],
  templateUrl: './mantenimientos-general.html',
  styleUrl: './mantenimientos-general.scss',
})
export class MantenimientosGeneralPage {
  private mant = inject(MantenimientosService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  fallo = signal(false);
  items = signal<MantenimientoItem[]>([]);
  eligiendoVehiculo = signal(false);

  // Filtros (se aplican en cliente sobre la página cargada).
  fVehiculo = signal('');
  fTipo = signal('');
  fEstado = signal('');
  fTaller = signal('');
  fDesde = signal('');
  fHasta = signal('');

  readonly tipoLabels = MANTENIMIENTO_TIPO_LABEL;
  tipoLabel = (t: string): string => MANTENIMIENTO_TIPO_LABEL[t as MantenimientoTipo] ?? t;
  fecha = formatFecha;

  /** Opciones del filtro de vehículo, derivadas de lo cargado (placa → id). */
  vehiculosFiltro = computed(() => {
    const map = new Map<string, string>();
    for (const m of this.items()) {
      if (m.vehiculo_id && m.placa) map.set(m.vehiculo_id, m.placa);
    }
    return [...map.entries()].map(([id, placa]) => ({ id, placa })).sort((a, b) => a.placa.localeCompare(b.placa));
  });

  filtrados = computed(() => {
    const veh = this.fVehiculo();
    const tipo = this.fTipo();
    const estado = this.fEstado();
    const taller = this.fTaller().trim().toLowerCase();
    const desde = this.fDesde();
    const hasta = this.fHasta();
    return this.items().filter((m) => {
      if (veh && m.vehiculo_id !== veh) return false;
      if (tipo && m.tipo !== tipo) return false;
      if (estado && m.estado !== estado) return false;
      if (taller && !(m.proveedor ?? '').toLowerCase().includes(taller)) return false;
      if (desde && m.fecha < desde) return false;
      if (hasta && m.fecha > hasta) return false;
      return true;
    });
  });

  hayFiltros = computed(
    () => !!(this.fVehiculo() || this.fTipo() || this.fEstado() || this.fTaller() || this.fDesde() || this.fHasta()),
  );

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.fallo.set(false);
    try {
      const list = await this.mant.listarMantenimientosGeneral();
      this.items.set(list);
    } catch {
      this.fallo.set(this.items().length === 0);
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(e: string): string {
    return e === 'completado' ? 'Completado' : e === 'en_proceso' ? 'En proceso' : 'Pendiente';
  }

  vehiculoLabel(m: MantenimientoItem): string {
    const marca = [m.marca, m.modelo].filter(Boolean).join(' ');
    return [m.placa, marca].filter(Boolean).join(' · ') || '—';
  }

  limpiarFiltros(): void {
    this.fVehiculo.set('');
    this.fTipo.set('');
    this.fEstado.set('');
    this.fTaller.set('');
    this.fDesde.set('');
    this.fHasta.set('');
  }

  // ── Nuevo mantenimiento: elegir vehículo → pantalla de registro (AG9) ──────────
  nuevo(): void {
    this.eligiendoVehiculo.set(true);
  }
  cancelarNuevo(): void {
    this.eligiendoVehiculo.set(false);
  }
  onVehiculoElegido(v: VehiculoDisponible): void {
    this.eligiendoVehiculo.set(false);
    void this.router.navigate(['/transporte/mantenimiento', v.vehiculo_id]);
  }

  abrirHistorial(m: MantenimientoItem): void {
    if (m.vehiculo_id) void this.router.navigate(['/transporte/mantenimientos', m.vehiculo_id]);
  }

  cerrarMant(m: MantenimientoItem, ev: Event): void {
    ev.stopPropagation();
    if (m.vehiculo_id) void this.router.navigate(['/transporte/mantenimiento', m.vehiculo_id, 'cerrar', m.id]);
  }

  back(): void {
    this.location.back();
  }
}
