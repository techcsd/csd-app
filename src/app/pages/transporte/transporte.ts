import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { EstadoChoferBar } from './estado-chofer/estado-chofer-bar';
import { GpsGateBanner } from '../../shared/components/gps-gate-banner/gps-gate-banner';
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
import { ModuleOrderService } from '../../core/services/module-order.service';
import { ToastService } from '../../core/services/toast.service';
import { MiAsignacion, PendientesTransporte, vehiculoIdentidad } from '../../core/models/transporte.model';

/** AI16 — clave namespaced del scope de submódulos de Transporte. */
const SUBMODULE_PARENT = 'transporte';

/** S15 — un cuadro del hub de transporte (patrón big-button del home). */
interface HubTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  /** true = solo roles elevados (R14); false/omitido = también el chofer. */
  elevado?: boolean;
}

// AI1 — Transporte v3: menú "10 botones", 3 por fila (iconos pequeños), según el
// sketch de Eduardo. Botones principales (todos los choferes) + un grupo de
// gestión (roles elevados). Los banners Estado (AF28) y Doc-en-proceso van ARRIBA,
// fuera del grid. Los flujos viejos siguen existiendo por sus rutas (redirects).
const TILES: HubTile[] = [
  // ── Botones principales (sketch AI1) ─────────────────────────────────────────
  { key: 'misRutas', icon: '🗺️', label: 'Rutas', tint: '#0d9488' },
  { key: 'conducesHub', icon: '🧾', label: 'Conduce', tint: '#1e3a5f' },
  { key: 'combustible', icon: '⛽', label: 'Registro Combustible', tint: '#dc2626' },
  // AI7 — "Uso de vehículo" (ex "Asignarme vehículo"): flujo unificado AF34.
  { key: 'usoVehiculo', icon: '🚗', label: 'Uso de Vehículo', tint: '#2563eb' },
  { key: 'multas', icon: '🚦', label: 'Multas', tint: '#b91c1c' },
  // AI13 — Aviso de vehículo (reportar novedad + ver alertas).
  { key: 'avisoVehiculo', icon: '📣', label: 'Aviso de Vehículo', tint: '#ca8a04' },
  // AI8 — "Inspección Vehículo" (ex "Reporte semanal").
  { key: 'semanal', icon: '📋', label: 'Inspección Vehículo', tint: '#f97316' },
  { key: 'actividad', icon: '📈', label: 'Mi Actividad', tint: '#16a34a' },
  // AT2 — "Mi rendimiento": informe de incentivo propio (puntaje semanal + badge).
  { key: 'miRendimiento', icon: '🏅', label: 'Mi Rendimiento', tint: '#eab308' },
  // AU7 — "Mi recorrido" (Timeline diario: trazo + paradas + estado offline).
  { key: 'miRecorrido', icon: '🗺️', label: 'Mi Recorrido', tint: '#0ea5e9' },

  // ── Gestión (solo roles elevados) ────────────────────────────────────────────
  { key: 'seguimiento', icon: '📍', label: 'Seguimiento', tint: '#7c3aed', elevado: true },
  // AP6 — Rutas activas (lista por chofer + histórico) para roles elevados.
  { key: 'rutasActivas', icon: '🛰️', label: 'Rutas activas', tint: '#0ea5e9', elevado: true },
  { key: 'combustibleLog', icon: '📊', label: 'Registro de echadas', tint: '#dc2626', elevado: true },
  { key: 'vehiculos', icon: '🚙', label: 'Vehículos', tint: '#0891b2', elevado: true },
  { key: 'conductores', icon: '🪪', label: 'Conductores', tint: '#7c3aed', elevado: true },
  { key: 'avisos', icon: '🔔', label: 'Avisos de flota', tint: '#ca8a04', elevado: true },
  // AT3 — Gestión del incentivo (logística/gerencia). La página se re-gatea con
  // puede_gestionar_incentivos(): un flota-elevado sin permiso ve "Sin acceso".
  { key: 'incentivos', icon: '🏆', label: 'Incentivos', tint: '#ca8a04', elevado: true },
];

/** Transporte hub: vehicles to receive / already in charge / self-assigned. */
@Component({
  selector: 'app-transporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, DecimalPipe, BigButton, EstadoChoferBar, GpsGateBanner],
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
  private moduleOrder = inject(ModuleOrderService);
  private toast = inject(ToastService);

  // V1 — documentación en proceso del módulo transporte/flota.
  private enProcesoCount = this.enProceso.counts;

  // AF28 — la barra de estado del chofer se muestra solo a choferes.
  esChofer = this.ctx.esChofer;
  esAdmin = () => this.ctx.esAdmin();

  // AI16 — orden de submódulos configurado por el admin (drag & drop).
  orderMap = signal<Record<string, number>>({});
  editMode = signal(false);
  editTiles = signal<HubTile[]>([]);
  dragIndex = signal<number | null>(null);
  private lpTimer: ReturnType<typeof setTimeout> | null = null;

  // AI1 — cuadros del hub gated por rol (R14): el chofer ve solo los suyos.
  // El banner "Doc. en proceso" ya no es un tile: va arriba (ver template).
  tiles = computed(() => {
    const base = TILES.filter((t) => !t.elevado || this.ctx.esFlotaElevado());
    return this.aplicarOrden(base);
  });

  /** AI16 — aplica el orden guardado de submódulos; los no configurados quedan
   *  después en su orden por defecto. */
  private aplicarOrden(all: HubTile[]): HubTile[] {
    const order = this.orderMap();
    const idx = new Map(all.map((t, i) => [t.key, i]));
    return [...all].sort((a, b) => {
      const oa = order[a.key] ?? 1000 + (idx.get(a.key) ?? 0);
      const ob = order[b.key] ?? 1000 + (idx.get(b.key) ?? 0);
      return oa - ob;
    });
  }

  pendientes = signal<PendientesTransporte>({ a_cargo: [], por_recibir: [] });
  asignaciones = signal<MiAsignacion[]>([]);
  // AF21 — km efectivo (servidor + outbox pendiente) por vehículo, para que los
  // cards del hub muestren el MISMO km que el perfil (una sola fuente de verdad).
  kmEff = signal<Record<string, number>>({});
  reporteSemanalPend = signal(0);
  conducesNuevas = signal(0); // Y3 — rutas planificadas asignadas no vistas
  firmasPendientes = signal(0); // AE — firmas de recepción por firmar
  pendienteEntrega = signal(0); // AI2 — conduces emitidos pendientes de entrega
  loading = signal(true);
  /** P4 — vehículos con una recepción encolada (se marcan "Enviando…"). */
  enviandoIds = signal<Set<string>>(new Set());

  // AK20 — "Asignados a mí" desaparece (se elimina el concepto de asignación).
  // El vacío del hub depende solo del modelo nuevo: en uso + disponibles.
  vacio = computed(
    () => !this.pendientes().a_cargo.length && !this.pendientes().por_recibir.length,
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
    void this.cargarOrden(); // AI16 — orden de submódulos configurado
  }

  // ── AI16 — orden de submódulos (drag & drop, solo admin) ───────────────────
  private async cargarOrden(): Promise<void> {
    try {
      const rows = await this.moduleOrder.getOrder();
      const map: Record<string, number> = {};
      for (const r of rows) if (r.parent === SUBMODULE_PARENT) map[r.clave] = r.orden;
      this.orderMap.set(map);
    } catch {
      /* best-effort: sin orden guardado, se usa el por defecto */
    }
  }

  onTilePointerDown(): void {
    if (!this.esAdmin() || this.editMode()) return;
    this.clearLongPress();
    this.lpTimer = setTimeout(() => this.entrarEdicion(), 600);
  }
  onTilePointerUp(): void {
    this.clearLongPress();
  }
  private clearLongPress(): void {
    if (this.lpTimer) {
      clearTimeout(this.lpTimer);
      this.lpTimer = null;
    }
  }

  entrarEdicion(): void {
    this.editTiles.set([...this.tiles()]);
    this.editMode.set(true);
  }

  private dragMove = (ev: PointerEvent): void => this.onDragMove(ev);
  private dragEnd = (): void => this.onDragEnd();

  onDragStart(i: number, ev: PointerEvent): void {
    ev.preventDefault();
    this.dragIndex.set(i);
    window.addEventListener('pointermove', this.dragMove);
    window.addEventListener('pointerup', this.dragEnd, { once: true });
    window.addEventListener('pointercancel', this.dragEnd, { once: true });
  }
  private onDragMove(ev: PointerEvent): void {
    const from = this.dragIndex();
    if (from == null) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const tileEl = el?.closest('[data-edit-index]') as HTMLElement | null;
    if (!tileEl) return;
    const to = Number(tileEl.dataset['editIndex']);
    if (Number.isNaN(to) || to === from) return;
    this.editTiles.update((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    this.dragIndex.set(to);
  }
  private onDragEnd(): void {
    window.removeEventListener('pointermove', this.dragMove);
    this.dragIndex.set(null);
  }

  async guardarOrden(): Promise<void> {
    const items = this.editTiles().map((t, i) => ({ clave: t.key, parent: SUBMODULE_PARENT, orden: i }));
    const map: Record<string, number> = {};
    items.forEach((it) => (map[it.clave] = it.orden));
    this.orderMap.set(map); // optimista
    this.editMode.set(false);
    try {
      await this.moduleOrder.setOrder(items);
      this.toast.success('Orden guardado.');
    } catch {
      this.toast.error('No se pudo guardar el orden. Inténtalo de nuevo.');
    }
  }
  cancelarOrden(): void {
    this.editMode.set(false);
    this.dragIndex.set(null);
  }

  /** S15 — badge del cuadro (inspección pendiente / avisos de flota). */
  badgeFor(key: string): number | null {
    if (key === 'semanal') return this.reporteSemanalPend() || null;
    if (key === 'misRutas') return this.conducesNuevas() || null; // Y3 — rutas nuevas
    if (key === 'conducesHub') return this.pendienteEntrega() || this.firmasPendientes() || null;
    if (key === 'avisos') return this.badges.counts()['flota'] || null;
    return null;
  }

  /** V1 — total de documentación en proceso del módulo flota (banner arriba). */
  docEnProceso = computed(() => this.enProcesoCount()['flota'] ?? 0);

  /** S15 — despacha el cuadro tocado a su pantalla. */
  openTile(t: HubTile): void {
    if (this.editMode()) return; // AI16 — en modo edición no se navega
    switch (t.key) {
      case 'misRutas': return this.misRutas();
      case 'conducesHub': return this.conducesHub();
      case 'seguimiento': return this.seguimiento();
      case 'rutasActivas': return this.rutasActivas();
      case 'combustible': return this.combustibleTop();
      case 'combustibleLog': return this.combustibleLog();
      case 'semanal': return this.reporteSemanal();
      case 'actividad': return this.miActividad();
      case 'miRendimiento': return void this.router.navigate(['/mi-rendimiento']);
      case 'miRecorrido': return void this.router.navigate(['/transporte/mi-recorrido']);
      case 'usoVehiculo': return this.usoVehiculo();
      case 'avisoVehiculo': return this.avisoVehiculo();
      case 'vehiculos': return this.vehiculosLista();
      case 'conductores': return this.conductoresLista();
      case 'multas': return this.multas();
      case 'avisos': return this.avisos();
      case 'incentivos': return void this.router.navigate(['/incentivos']);
    }
  }

  /** AI13 — módulo "Aviso de vehículo" (reportar novedad + alertas). */
  avisoVehiculo(): void {
    void this.router.navigate(['/transporte/aviso-vehiculo']);
  }

  /** AF22 — Mis rutas (activas / hoy / historial). Reutiliza la pantalla de rutas. */
  misRutas(): void {
    void this.router.navigate(['/transporte/mis-rutas']);
  }

  /** AF22 — núcleo Conduces (crear · recibir · devolver · ferretería · por firmar · historial). */
  conducesHub(): void {
    void this.router.navigate(['/transporte/conduces-hub']);
  }

  /** AF27 — Seguimiento en vivo (jefe de flota / admin / tecnología). */
  seguimiento(): void {
    void this.router.navigate(['/transporte/seguimiento']);
  }

  /** AP6 — Rutas activas: lista por chofer + histórico (roles elevados). */
  rutasActivas(): void {
    void this.router.navigate(['/transporte/rutas-activas']);
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
  /** AE — devolver material: es un conduce con destino suplidor. QA-14 — usa la MISMA
   *  ruta pre-llenada que conduces-hub (antes iba a /devolver-material, otro backend). */
  devolverMaterial(): void {
    void this.router.navigate(['/transporte/generar-conduce'], {
      queryParams: { origen: 'almacen', destino: 'suplidor' },
    });
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

      // AI2 — conduces pendientes de entrega (badge del menú Conduce).
      void this.conducesSvc
        .pendientesEntregaCount()
        .then((n) => this.pendienteEntrega.set(n))
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

  /** AK15/AK20 — "Uso de vehículo" v2 (reemplaza asignarme). Sin vehículo → elige del pool. */
  usoVehiculo(): void {
    void this.router.navigate(['/transporte/uso-vehiculo']);
  }

  /** AK14/AK15 — usar un vehículo concreto (desde su card). */
  usar(v: { vehiculo_id: string; placa?: string; marca?: string; modelo?: string; color?: string | null }): void {
    void this.router.navigate(['/transporte/uso-vehiculo', v.vehiculo_id], {
      queryParams: { placa: v.placa, label: vehiculoIdentidad(v) },
    });
  }

  /** AK14/AK15 — soltar el vehículo que tengo en uso (pide km + nivel). */
  soltar(v: { vehiculo_id: string; placa?: string; marca?: string; modelo?: string; color?: string | null }): void {
    void this.router.navigate(['/transporte/uso-vehiculo', v.vehiculo_id], {
      queryParams: { mode: 'soltar', placa: v.placa, label: vehiculoIdentidad(v) },
    });
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
    // AG9 — abre el hub de mantenimientos (historial + registrar + cerrar).
    void this.router.navigate(['/transporte/mantenimientos', vehiculoId]);
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
