import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { VehiculosService } from '../../core/services/vehiculos.service';
import { ReporteSemanalService } from '../../core/services/reporte-semanal.service';
import { SyncService } from '../../core/sync/sync.service';
import { UserContextService } from '../../core/services/user-context.service';
import { BadgesService } from '../../core/services/badges.service';
import { EnProcesoService } from '../../core/services/en-proceso.service';
import { MiAsignacion, PendientesTransporte } from '../../core/models/transporte.model';

/** S15 — un cuadro del hub de transporte (patrón big-button del home). */
interface HubTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  /** true = solo roles elevados (R14); false/omitido = también el chofer. */
  elevado?: boolean;
}

const TILES: HubTile[] = [
  { key: 'conduces', icon: '🧾', label: 'Conduces y rutas', tint: '#1e3a5f' },
  { key: 'combustible', icon: '⛽', label: 'Registrar combustible', tint: '#dc2626' },
  { key: 'semanal', icon: '📋', label: 'Reporte semanal', tint: '#f97316' },
  { key: 'actividad', icon: '📈', label: 'Mi actividad', tint: '#16a34a' },
  { key: 'asignar', icon: '➕', label: 'Asignarme vehículo', tint: '#2563eb' },
  { key: 'vehiculos', icon: '🚙', label: 'Vehículos', tint: '#0891b2', elevado: true },
  { key: 'conductores', icon: '🪪', label: 'Conductores', tint: '#7c3aed', elevado: true },
  { key: 'crearRuta', icon: '🗺️', label: 'Crear ruta', tint: '#0d9488', elevado: true },
  { key: 'avisos', icon: '🔔', label: 'Avisos de flota', tint: '#ca8a04', elevado: true },
];

/** Transporte hub: vehicles to receive / already in charge / self-assigned. */
@Component({
  selector: 'app-transporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, DecimalPipe, BigButton],
  templateUrl: './transporte.html',
  styleUrl: './transporte.scss',
})
export class TransportePage {
  private vehiculos = inject(VehiculosService);
  private reportes = inject(ReporteSemanalService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private location = inject(Location);
  private ctx = inject(UserContextService);
  private badges = inject(BadgesService);
  private enProceso = inject(EnProcesoService);

  // V1 — documentación en proceso del módulo transporte/flota.
  private enProcesoCount = this.enProceso.counts;

  // S15 — cuadros del hub gated por rol (R14): el chofer ve solo los suyos.
  // V1 — añade "Documentación en proceso" cuando hay borradores/envíos pendientes.
  tiles = computed(() => {
    const base = TILES.filter((t) => !t.elevado || this.ctx.esFlotaElevado());
    if ((this.enProcesoCount()['flota'] ?? 0) > 0) {
      base.push({ key: 'enProceso', icon: '📥', label: 'Documentación en proceso', tint: '#78716c' });
    }
    return base;
  });

  pendientes = signal<PendientesTransporte>({ a_cargo: [], por_recibir: [] });
  asignaciones = signal<MiAsignacion[]>([]);
  reporteSemanalPend = signal(0);
  loading = signal(true);
  /** P4 — vehículos con una recepción encolada (se marcan "Enviando…"). */
  enviandoIds = signal<Set<string>>(new Set());

  /** Active assignments not already shown in a_cargo / por_recibir (multi-asignación). */
  otrasAsignaciones = computed(() => {
    const known = new Set([
      ...this.pendientes().a_cargo.map((v) => v.vehiculo_id),
      ...this.pendientes().por_recibir.map((v) => v.vehiculo_id),
    ]);
    return this.asignaciones().filter((a) => !known.has(a.vehiculo_id));
  });

  vacio = computed(
    () =>
      !this.pendientes().a_cargo.length &&
      !this.pendientes().por_recibir.length &&
      !this.otrasAsignaciones().length,
  );

  constructor() {
    // P4 — recarga al entrar Y tras cada cambio del outbox (drain exitoso incl.):
    // así, al enviar una recepción, el vehículo se marca "Enviando…" y, cuando
    // el servidor confirma, desaparece del listado sin quedarse pegado.
    effect(() => {
      this.sync.changed();
      void this.load();
    });
    void this.badges.load(); // S15 — badge de avisos en el cuadro
    void this.enProceso.refresh(); // V1 — contador de documentación en proceso
  }

  /** S15 — badge del cuadro (reporte semanal pendiente / avisos de flota). */
  badgeFor(key: string): number | null {
    if (key === 'semanal') return this.reporteSemanalPend() || null;
    if (key === 'avisos') return this.badges.counts()['flota'] || null;
    if (key === 'enProceso') return this.enProcesoCount()['flota'] || null;
    return null;
  }

  /** S15 — despacha el cuadro tocado a su pantalla. */
  openTile(t: HubTile): void {
    switch (t.key) {
      case 'conduces': return this.conduces();
      case 'combustible': return this.combustibleTop();
      case 'semanal': return this.reporteSemanal();
      case 'actividad': return this.miActividad();
      case 'asignar': return this.asignar();
      case 'vehiculos': return this.vehiculosLista();
      case 'conductores': return this.conductoresLista();
      case 'crearRuta': return this.crearRuta();
      case 'avisos': return this.avisos();
      case 'enProceso': return this.enProcesoAbrir();
    }
  }

  /** V1 — documentación en proceso (borradores + envíos pendientes). */
  enProcesoAbrir(): void {
    void this.router.navigate(['/en-proceso']);
  }

  /** S26b — combustible sin vehículo en contexto (la pantalla elige del pool). */
  combustibleTop(): void {
    void this.router.navigate(['/transporte/combustible']);
  }

  /** S16 — crear ruta (solo elevados; el wizard tipo hoja llega en FASE 3). */
  crearRuta(): void {
    void this.router.navigate(['/transporte/rutas/crear']);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [pend, asig, semanalPend, enviando] = await Promise.all([
        this.vehiculos.misPendientes(),
        this.vehiculos.getMisAsignaciones(),
        this.reportes.pendientesCount(),
        this.vehiculos.entregasRecepcionPendientes(),
      ]);
      this.pendientes.set(pend);
      this.asignaciones.set(asig);
      this.reporteSemanalPend.set(semanalPend);
      this.enviandoIds.set(enviando);
    } finally {
      this.loading.set(false);
    }
  }

  /** P4 — ¿este vehículo tiene una recepción encolada esperando enviarse? */
  estaEnviando(vehiculoId: string): boolean {
    return this.enviandoIds().has(vehiculoId);
  }

  asignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  reporteSemanal(): void {
    void this.router.navigate(['/transporte/reporte-semanal']);
  }

  perfilVehiculo(vehiculoId: string): void {
    void this.router.navigate(['/transporte/vehiculo', vehiculoId]);
  }

  miActividad(): void {
    void this.router.navigate(['/transporte/mi-actividad']);
  }

  vehiculosLista(): void {
    void this.router.navigate(['/transporte/vehiculos']);
  }

  conductoresLista(): void {
    void this.router.navigate(['/transporte/conductores']);
  }

  avisos(): void {
    void this.router.navigate(['/transporte/avisos']);
  }

  recibir(vehiculoId: string): void {
    void this.router.navigate(['/transporte/recibir', vehiculoId]);
  }

  devolver(vehiculoId: string): void {
    void this.router.navigate(['/transporte/devolver', vehiculoId]);
  }

  preuso(vehiculoId: string): void {
    void this.router.navigate(['/transporte/preuso', vehiculoId]);
  }

  mantenimiento(vehiculoId: string): void {
    void this.router.navigate(['/transporte/mantenimiento', vehiculoId]);
  }

  combustible(vehiculoId: string): void {
    void this.router.navigate(['/transporte/combustible', vehiculoId]);
  }

  conduces(): void {
    void this.router.navigate(['/transporte/conduces']);
  }

  back(): void {
    this.location.back();
  }
}
