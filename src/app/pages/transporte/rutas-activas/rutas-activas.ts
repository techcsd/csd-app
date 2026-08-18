import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, RutaActivaHoy, RutaHistorial } from '../../../core/services/conduces.service';
import { SeguimientoService, ChoferSeguimiento } from '../../../core/services/seguimiento.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { estadoMeta } from '../../../core/services/chofer-estado.service';
import { vehiculoIdentidad } from '../../../core/models/transporte.model';

type Tab = 'activas' | 'historico';

const ESTADO_RUTA: { key: string; label: string }[] = [
  { key: 'en_curso', label: 'En curso' },
  { key: 'planificada', label: 'Planificada' },
  { key: 'completada', label: 'Completada' },
  { key: 'cancelada', label: 'Cancelada' },
];

/**
 * AP6 — Submódulo "Rutas activas" para roles elevados (jefe de flota incl.).
 * Complementa el mapa de Seguimiento con una vista de LISTA:
 *  · Tab "Activas": choferes con su estado + las rutas en curso (destino, paradas,
 *    duración corriendo, última posición "hace X min"). Reutiliza los contratos de
 *    Seguimiento (rutas_activas_y_hoy + choferes_estado) — cero pipeline paralelo.
 *  · Tab "Histórico": todas las rutas creadas con filtros (chofer, fechas, obra,
 *    estado) vía rutas_historial (AP6).
 */
@Component({
  selector: 'app-rutas-activas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, DecimalPipe, CollapsibleSelect, LiveRefreshDirective],
  templateUrl: './rutas-activas.html',
  styleUrl: './rutas-activas.scss',
})
export class RutasActivasPage implements OnDestroy {
  private conduces = inject(ConducesService);
  private seguimiento = inject(SeguimientoService);
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  readonly estadoMeta = estadoMeta;
  readonly estadosRuta = ESTADO_RUTA;
  readonly ident = vehiculoIdentidad; // AT9

  autorizado = signal(true);
  tab = signal<Tab>('activas');
  loading = signal(true);

  // Tab activas
  private rutas = signal<RutaActivaHoy[]>([]);
  choferes = signal<ChoferSeguimiento[]>([]);
  activas = computed(() => this.rutas().filter((r) => r.seccion === 'activa'));

  // Tab histórico + filtros
  historial = signal<RutaHistorial[]>([]);
  cargandoHist = signal(false);
  obras = signal<{ id: string; label: string }[]>([]);
  choferOpciones = computed(() => [
    { id: '', label: 'Todos los choferes' },
    ...this.choferes().map((c) => ({ id: c.conductor_id, label: c.nombre })),
  ]);
  obraOpciones = computed(() => [{ id: '', label: 'Todas las obras' }, ...this.obras()]);
  fConductor = signal<string>('');
  fObra = signal<string>('');
  fEstado = signal<string>('');
  fDesde = signal<string>('');
  fHasta = signal<string>('');

  constructor() {
    if (!this.ctx.esFlotaElevado()) {
      this.autorizado.set(false);
      this.loading.set(false);
      return;
    }
    void this.cargarActivas();
    void this.inventario
      .getObrasDestino()
      .then((os) => this.obras.set(os.map((o) => ({ id: o.id, label: o.nombre }))))
      .catch(() => {});
    this.seguimiento.suscribir(() => void this.cargarActivas(true));
  }

  ngOnDestroy(): void {
    this.seguimiento.desuscribir();
  }

  async cargarActivas(silent = false): Promise<void> {
    if (!this.autorizado()) return;
    if (!silent) this.loading.set(true);
    try {
      const [r, ch] = await Promise.all([
        this.conduces.rutasActivasYHoy().catch(() => [] as RutaActivaHoy[]),
        this.seguimiento.choferes().catch(() => [] as ChoferSeguimiento[]),
      ]);
      this.rutas.set(r);
      this.choferes.set(ch);
    } finally {
      this.loading.set(false);
    }
  }

  onRefresh = (silent = false): void => {
    if (this.tab() === 'activas') void this.cargarActivas(silent);
    else void this.cargarHistorial();
  };

  async setTab(t: Tab): Promise<void> {
    this.tab.set(t);
    if (t === 'historico' && !this.historial().length) await this.cargarHistorial();
  }

  async cargarHistorial(): Promise<void> {
    this.cargandoHist.set(true);
    try {
      this.historial.set(
        await this.conduces.rutasHistorial({
          conductorId: this.fConductor() || null,
          obraId: this.fObra() || null,
          estado: this.fEstado() || null,
          desde: this.fDesde() || null,
          hasta: this.fHasta() || null,
        }),
      );
    } finally {
      this.cargandoHist.set(false);
    }
  }

  aplicarFiltros(): void {
    void this.cargarHistorial();
  }
  onConductor(id: string): void {
    this.fConductor.set(id);
    void this.cargarHistorial();
  }
  onObra(id: string): void {
    this.fObra.set(id);
    void this.cargarHistorial();
  }
  setEstado(e: string): void {
    this.fEstado.set(this.fEstado() === e ? '' : e);
    void this.cargarHistorial();
  }

  /** Detalle con trayecto: reutiliza el mapa de Seguimiento (breadcrumb en vivo). */
  verEnMapa(): void {
    void this.router.navigate(['/transporte/seguimiento']);
  }

  /** AU5 — trayectoria (replay estático) de una ruta del histórico. */
  verTrayectoria(rutaId: string): void {
    void this.router.navigate(['/transporte/trayectoria', rutaId]);
  }

  // ── Helpers de tiempo ─────────────────────────────────────────────────────
  /** "hace X min/h" desde una marca ISO; '' si no hay. */
  hace(ts: string | null): string {
    if (!ts) return '';
    const d = new Date(ts).getTime();
    if (isNaN(d)) return '';
    const min = Math.max(0, Math.round((Date.now() - d) / 60000));
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    return `hace ${h} h ${min % 60} min`;
  }

  /** AV13 — hora corta de la última modificación (chip "(modificada)"). */
  fmtHora(iso: string | null | undefined): string {
    return iso ? formatFechaCortaHora(iso) : '';
  }

  /** Duración corriendo desde el inicio de la ruta (para las activas). */
  corriendo(iniciada: string | null): string {
    if (!iniciada) return '';
    const min = Math.max(0, Math.round((Date.now() - new Date(iniciada).getTime()) / 60000));
    if (isNaN(min)) return '';
    const h = Math.floor(min / 60);
    return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
  }

  /** Última posición de un chofer (por su conductor→usuario) para la fila de ruta. */
  ultimaPos(conductorNombre: string | null): string {
    if (!conductorNombre) return '';
    const c = this.choferes().find((x) => x.nombre === conductorNombre);
    return c?.capturado_en ? this.hace(c.capturado_en) : '';
  }

  estadoRutaLabel(estado: string): string {
    return ESTADO_RUTA.find((e) => e.key === estado)?.label ?? estado;
  }

  back(): void {
    this.location.back();
  }
}
