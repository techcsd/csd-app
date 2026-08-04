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
import { ConducesService } from '../../core/services/conduces.service';
import { InventarioService } from '../../core/services/inventario.service';
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
  // Z24 — "Hacer pre-uso" directo desde el hub: el chofer llega a la inspección
  // en ≤2 toques (la pantalla elige el vehículo del pool si no hay contexto).
  { key: 'preuso', icon: '📝', label: 'Hacer pre-uso', tint: '#0369a1' },
  { key: 'combustible', icon: '⛽', label: 'Registrar combustible', tint: '#dc2626' },
  // AF17 — registro/log de echadas (solo roles elevados).
  { key: 'combustibleLog', icon: '📊', label: 'Registro de echadas', tint: '#dc2626', elevado: true },
  // AD6 — funciones de inventario del chofer dentro de Transporte.
  { key: 'recibirMercancia', icon: '📥', label: 'Recibir mercancía', tint: '#0f766e' },
  // AE — el chofer genera un conduce (saca material de un almacén hacia una obra).
  { key: 'sacarMaterial', icon: '📦', label: 'Sacar material', tint: '#7c3aed' },
  // AE — devolver material de una obra a un almacén (con doble firma).
  { key: 'devolverMaterial', icon: '↩️', label: 'Devolver material', tint: '#0f766e' },
  { key: 'ferreteria', icon: '🧾', label: 'Compra en ferretería', tint: '#9333ea' },
  // AE — firmas de recepción pendientes asignadas a mí.
  { key: 'porFirmar', icon: '✍️', label: 'Por firmar', tint: '#ca8a04' },
  { key: 'semanal', icon: '📋', label: 'Reporte semanal', tint: '#f97316' },
  { key: 'actividad', icon: '📈', label: 'Mi actividad', tint: '#16a34a' },
  { key: 'asignar', icon: '➕', label: 'Asignarme vehículo', tint: '#2563eb' },
  // AF36 — historial de recepciones/traspasos de vehículo (actas).
  { key: 'misActas', icon: '📥', label: 'Recepciones de vehículo', tint: '#0891b2' },
  { key: 'vehiculos', icon: '🚙', label: 'Vehículos', tint: '#0891b2', elevado: true },
  { key: 'conductores', icon: '🪪', label: 'Conductores', tint: '#7c3aed', elevado: true },
  // El chofer también puede crearse rutas a sí mismo (se auto-asigna); el jefe de
  // flota además elige a quién se la asigna. Por eso NO va gateado como elevado.
  { key: 'crearRuta', icon: '🗺️', label: 'Crear ruta', tint: '#0d9488' },
  // Z24 — historial de checklists visible para TODO chofer (RLS chk_veh_sel: el
  // chofer solo ve los suyos; el jefe de flota ve lo que envían todos).
  { key: 'checklists', icon: '✅', label: 'Historial de checklists', tint: '#0369a1' },
  // Y7 — "Me pusieron una multa": visible para TODO chofer (no solo elevados).
  { key: 'multas', icon: '🚦', label: 'Multas', tint: '#b91c1c' },
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
  private conducesSvc = inject(ConducesService);
  private inventario = inject(InventarioService);

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
  // AF21 — km efectivo (servidor + outbox pendiente) por vehículo, para que los
  // cards del hub muestren el MISMO km que el perfil (una sola fuente de verdad).
  kmEff = signal<Record<string, number>>({});
  reporteSemanalPend = signal(0);
  conducesNuevas = signal(0); // Y3 — rutas planificadas asignadas no vistas
  firmasPendientes = signal(0); // AE — firmas de recepción por firmar
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
    if (key === 'conduces') return this.conducesNuevas() || null; // Y3
    if (key === 'porFirmar') return this.firmasPendientes() || null; // AE
    if (key === 'avisos') return this.badges.counts()['flota'] || null;
    if (key === 'enProceso') return this.enProcesoCount()['flota'] || null;
    return null;
  }

  /** S15 — despacha el cuadro tocado a su pantalla. */
  openTile(t: HubTile): void {
    switch (t.key) {
      case 'conduces': return this.conduces();
      case 'preuso': return this.preusoTop();
      case 'combustible': return this.combustibleTop();
      case 'combustibleLog': return this.combustibleLog();
      case 'recibirMercancia': return this.recibirMercancia();
      case 'sacarMaterial': return this.sacarMaterial();
      case 'devolverMaterial': return this.devolverMaterial();
      case 'porFirmar': return this.porFirmar();
      case 'ferreteria': return this.ferreteria();
      case 'semanal': return this.reporteSemanal();
      case 'actividad': return this.miActividad();
      case 'asignar': return this.asignar();
      case 'misActas': return this.misActas();
      case 'vehiculos': return this.vehiculosLista();
      case 'conductores': return this.conductoresLista();
      case 'crearRuta': return this.crearRuta();
      case 'checklists': return this.checklistsHistorial();
      case 'multas': return this.multas();
      case 'avisos': return this.avisos();
      case 'enProceso': return this.enProcesoAbrir();
    }
  }

  /** V1 — documentación en proceso (borradores + envíos pendientes). Y10 — el
   *  cuadro cuenta solo flota, así que la vista se filtra a flota para casar el
   *  badge con lo mostrado. */
  enProcesoAbrir(): void {
    void this.router.navigate(['/en-proceso'], { queryParams: { modulo: 'flota' } });
  }

  /** S26b — combustible sin vehículo en contexto (la pantalla elige del pool). */
  combustibleTop(): void {
    void this.router.navigate(['/transporte/combustible']);
  }

  /** AF17 — registro de echadas (roles elevados). */
  combustibleLog(): void {
    void this.router.navigate(['/transporte/combustible-log']);
  }

  /** Z24 — pre-uso sin vehículo en contexto (la pantalla elige del pool). ≤2 toques. */
  preusoTop(): void {
    void this.router.navigate(['/transporte/preuso']);
  }

  /** S16 — crear ruta (solo elevados; el wizard tipo hoja llega en FASE 3). */
  crearRuta(): void {
    void this.router.navigate(['/transporte/rutas/crear']);
  }

  // AD6 — funciones de inventario del chofer dentro de Transporte.
  recibirMercancia(): void {
    void this.router.navigate(['/transporte/recibir-mercancia']);
  }
  ferreteria(): void {
    void this.router.navigate(['/transporte/ferreteria']);
  }
  /** AE — generar conduce: sacar material de un almacén hacia una obra. */
  sacarMaterial(): void {
    void this.router.navigate(['/transporte/generar-conduce']);
  }
  /** AE — devolver material de una obra a un almacén (doble firma). */
  devolverMaterial(): void {
    void this.router.navigate(['/transporte/devolver-material']);
  }
  /** AE — bandeja "Por firmar" (firmas de recepción pendientes). */
  porFirmar(): void {
    void this.router.navigate(['/transporte/por-firmar']);
  }

  /** Y7 — historial de checklists (jefe de flota). */
  checklistsHistorial(): void {
    void this.router.navigate(['/transporte/checklists']);
  }

  /** Y7 — registrar multa desde el hub (la pantalla pide el conductor). */
  multas(): void {
    void this.router.navigate(['/transporte/multa']);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [pend, asig, semanalPend, enviando, conducesNuevas] = await Promise.all([
        this.vehiculos.misPendientes(),
        this.vehiculos.getMisAsignaciones(),
        this.reportes.pendientesCount(),
        this.vehiculos.entregasRecepcionPendientes(),
        this.conducesSvc.rutasPlanificadasNuevas().catch(() => 0), // Y3
      ]);
      this.pendientes.set(pend);
      this.asignaciones.set(asig);
      this.reporteSemanalPend.set(semanalPend);
      this.enviandoIds.set(enviando);
      this.conducesNuevas.set(conducesNuevas);
      void this.computeKmEfectivo(pend, asig); // AF21

      // AE — firmas de recepción por firmar (best-effort).
      void this.inventario
        .misFirmasPendientes()
        .then((l) => this.firmasPendientes.set(l.length))
        .catch(() => {});
    } finally {
      this.loading.set(false);
    }
  }

  /** P4 — ¿este vehículo tiene una recepción encolada esperando enviarse? */
  estaEnviando(vehiculoId: string): boolean {
    return this.enviandoIds().has(vehiculoId);
  }

  /** AF21 — reconcilia el km de cada card con el outbox (misma regla que el perfil).
   *  Así, si el chofer echó combustible/pre-uso offline (o antes del drain), el hub
   *  muestra el km efectivo y no el número viejo cacheado del servidor. */
  private async computeKmEfectivo(pend: PendientesTransporte, asig: MiAsignacion[]): Promise<void> {
    const bases = new Map<string, number>();
    for (const v of [...pend.a_cargo, ...pend.por_recibir]) bases.set(v.vehiculo_id, v.km ?? 0);
    for (const a of asig) if (!bases.has(a.vehiculo_id)) bases.set(a.vehiculo_id, a.km ?? 0);
    const entries = await Promise.all(
      [...bases].map(async ([id, base]) => {
        const km = await this.vehiculos.kmEfectivo(id, base).catch(() => base);
        return [id, km ?? base] as const;
      }),
    );
    this.kmEff.set(Object.fromEntries(entries));
  }

  /** AF21 — km a pintar en un card: el efectivo si ya se calculó, si no el base. */
  kmOf(v: { vehiculo_id: string; km: number }): number {
    return this.kmEff()[v.vehiculo_id] ?? v.km;
  }

  asignar(): void {
    // AF34 — flujo unificado (asignarme + pre-uso + traspaso con acta).
    void this.router.navigate(['/transporte/asignarme']);
  }

  /** AF36 — historial de recepciones/traspasos de vehículo. */
  misActas(): void {
    void this.router.navigate(['/transporte/mis-actas']);
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
