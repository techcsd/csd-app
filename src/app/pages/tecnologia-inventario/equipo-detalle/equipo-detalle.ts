import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { EstadoChip } from '../../../shared/ui/estado-chip/estado-chip';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VaultSecureDirective } from '../../../shared/ui/vault-secure/vault-secure.directive';
import { TecnologiaService } from '../../../core/services/tecnologia.service';
import { TecClaveService } from '../../../core/services/tec-clave.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { Bodega } from '../../../core/models/inventario.model';
import { TecEquipo, TecTipo, TecEquipoEstado, TecEquipoCondicion, TecKitEstado } from '../../../core/models/tecnologia.model';
import { tecTonoEstado, tecTonoCondicion } from '../../../shared/utils/tec-tono.util';
import { ToastService } from '../../../core/services/toast.service';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const COSTO_ORIGEN_LABEL: Record<string, string> = { compra: 'Compra', estimado: 'Estimado', donado: 'Donado' };

/** AL2/DA — Detalle de un equipo tecnológico: ficha completa (DA1/DA5), kit (DA3), clave (DA6). */
@Component({
  selector: 'app-tec-equipo-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    DatePipe,
    FormsModule,
    Skeleton,
    EmptyState,
    EstadoChip,
    CollapsibleSelect,
    ConfirmDialog,
    VaultSecureDirective,
    ...MOTION_DIRECTIVES,
  ],
  templateUrl: './equipo-detalle.html',
  styleUrl: './equipo-detalle.scss',
})
export class TecEquipoDetallePage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tec = inject(TecnologiaService);
  private clave = inject(TecClaveService);
  private inventario = inject(InventarioService);
  private location = inject(Location);
  private toast = inject(ToastService);
  network = inject(NetworkService);
  ctx = inject(UserContextService);

  readonly costoOrigenLabel = COSTO_ORIGEN_LABEL;

  id = this.route.snapshot.paramMap.get('id') ?? '';
  loading = signal(true);
  equipo = signal<TecEquipo | null>(null);
  tipos = signal<TecTipo[]>([]);
  estados = signal<TecEquipoEstado[]>([]);
  condiciones = signal<TecEquipoCondicion[]>([]);
  bodegas = signal<Bodega[]>([]);
  garantiaDias = signal(30);
  urls = signal<string[]>([]);
  specsUrls = signal<string[]>([]);
  lightbox = signal<number | null>(null);
  componentes = signal<TecEquipo[]>([]);
  kitPadre = signal<TecEquipo | null>(null);

  tipoLabel = computed(() => this.tipos().find((t) => t.id === this.equipo()?.tipo_id)?.label ?? '—');
  grupos = computed(() => this.tipos().find((t) => t.id === this.equipo()?.tipo_id)?.grupos_campos ?? []);
  estadoLabel = computed(() => this.estados().find((e) => e.clave === this.equipo()?.estado)?.label ?? this.equipo()?.estado ?? '');
  condicionLabel = computed(
    () => this.condiciones().find((c) => c.clave === this.equipo()?.condicion)?.label ?? this.equipo()?.condicion ?? '',
  );
  estadoTono = computed(() => tecTonoEstado(this.equipo()?.estado));
  condicionTono = computed(() => tecTonoCondicion(this.equipo()?.condicion));
  bodegaLabel = computed(() => this.bodegas().find((b) => b.id === this.equipo()?.bodega_id)?.nombre ?? null);

  esKit = computed(() => this.componentes().length > 0);
  kitEstado = computed<TecKitEstado | null>(() => (this.esKit() ? this.tec.kitEstadoDe(this.componentes()) : null));

  garantiaAlerta = computed(() => {
    const e = this.equipo();
    return e ? this.tec.garantiaPorVencer(e, this.garantiaDias()) : false;
  });

  // ── Clave del equipo (A3/DA6) — solo ver, 30s, nada en el dispositivo ──────
  claveCargando = signal(false);
  claveValor = signal<string | null>(null);
  claveTipo = signal<'personal' | 'compartida' | null>(null);
  claveSegundos = signal(0);
  private claveTimer: ReturnType<typeof setInterval> | null = null;

  // ── Mover kit completo (A2, online) ────────────────────────────────────────
  moviendoKit = signal(false);
  moverBodegaId = signal('');
  moverUbicacion = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));

  confirmQuitar = signal<TecEquipo | null>(null);

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.limpiarClaveTimer();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [e, tipos, estados, condiciones, dias, bodegas] = await Promise.all([
        this.tec.getEquipo(this.id),
        this.tec.getTipos(),
        this.tec.getEstados(),
        this.tec.getCondiciones(),
        this.tec.getGarantiaAlertaDias(),
        this.inventario.getBodegas().catch(() => [] as Bodega[]),
      ]);
      this.equipo.set(e);
      this.tipos.set(tipos);
      this.estados.set(estados);
      this.condiciones.set(condiciones);
      this.garantiaDias.set(dias);
      this.bodegas.set(bodegas);
      if (e) {
        const [componentes, padre] = await Promise.all([
          this.tec.getComponentes(e.id),
          e.kit_padre_id ? this.tec.getEquipo(e.kit_padre_id) : Promise.resolve(null),
        ]);
        this.componentes.set(componentes);
        this.kitPadre.set(padre);

        const paths = e.fotos && e.fotos.length ? e.fotos : [e.foto_portada, e.foto_path].filter((p): p is string => !!p);
        const portada = e.foto_portada;
        const ordered = portada ? [portada, ...paths.filter((p) => p !== portada)] : paths;
        const urls: string[] = [];
        for (const p of ordered) {
          const u = await this.tec.fotoUrl(p);
          if (u) urls.push(u);
        }
        this.urls.set(urls);

        const specsUrls: string[] = [];
        for (const p of e.fotos_specs ?? []) {
          const u = await this.tec.fotoUrl(p);
          if (u) specsUrls.push(u);
        }
        this.specsUrls.set(specsUrls);
      }
    } catch {
      this.toast.error('No pudimos cargar el equipo.');
    } finally {
      this.loading.set(false);
    }
  }

  abrirLightbox(i: number): void {
    this.lightbox.set(i);
  }
  cerrarLightbox(): void {
    this.lightbox.set(null);
  }
  lightboxUrl = computed(() => {
    const i = this.lightbox();
    return i == null ? null : (this.urls()[i] ?? null);
  });

  // ── Clave ───────────────────────────────────────────────────────────────────
  async mostrarClave(): Promise<void> {
    if (!this.ctx.puedeVerClavesEquipos()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para ver la clave.');
      return;
    }
    this.claveCargando.set(true);
    try {
      const r = await this.clave.ver(this.id);
      this.claveValor.set(r.valor);
      this.claveTipo.set(r.tipo_clave);
      this.claveSegundos.set(r.visible_segundos);
      this.armarTimerClave();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo obtener la clave.');
    } finally {
      this.claveCargando.set(false);
    }
  }

  private armarTimerClave(): void {
    this.limpiarClaveTimer();
    this.claveTimer = setInterval(() => {
      const n = this.claveSegundos() - 1;
      this.claveSegundos.set(n);
      if (n <= 0) this.ocultarClave();
    }, 1000);
  }

  private limpiarClaveTimer(): void {
    if (this.claveTimer) clearInterval(this.claveTimer);
    this.claveTimer = null;
  }

  ocultarClave(): void {
    this.claveValor.set(null);
    this.claveTipo.set(null);
    this.limpiarClaveTimer();
  }

  /** CZ7/DZ-19 — misma salvaguarda que el Vault: app a segundo plano = borra el secreto de memoria. */
  alFondoClave(): void {
    this.ocultarClave();
  }

  async copiarClave(valor: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(valor);
      this.toast.success('Copiado — se borra del portapapeles en 30 s');
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => undefined);
      }, 30_000);
    } catch {
      this.toast.error('No se pudo copiar.');
    }
  }

  // ── Kit ─────────────────────────────────────────────────────────────────────
  abrirComponente(c: TecEquipo): void {
    void this.router.navigate(['/tecnologia-inventario', c.id]);
  }
  abrirKitPadre(): void {
    const p = this.kitPadre();
    if (p) void this.router.navigate(['/tecnologia-inventario', p.id]);
  }

  abrirMoverKit(): void {
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para mover el kit.');
      return;
    }
    const e = this.equipo();
    this.moverBodegaId.set(e?.bodega_id ?? '');
    this.moverUbicacion.set(e?.ubicacion ?? '');
    this.moviendoKit.set(true);
  }
  cancelarMoverKit(): void {
    this.moviendoKit.set(false);
  }
  async confirmarMoverKit(): Promise<void> {
    const e = this.equipo();
    if (!e) return;
    try {
      await this.tec.moverKit(e, { bodegaId: this.moverBodegaId() || null, ubicacion: this.moverUbicacion().trim() || null });
      this.toast.success('Kit movido.');
      this.moviendoKit.set(false);
      await this.load();
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'No se pudo mover el kit.');
    }
  }

  async togglePresente(c: TecEquipo): Promise<void> {
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para esto.');
      return;
    }
    try {
      await this.tec.marcarPresente(c.id, !c.presente);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }

  pedirQuitarDelKit(c: TecEquipo): void {
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para esto.');
      return;
    }
    this.confirmQuitar.set(c);
  }
  cancelarQuitar(): void {
    this.confirmQuitar.set(null);
  }
  async confirmarQuitarDelKit(): Promise<void> {
    const c = this.confirmQuitar();
    if (!c) return;
    try {
      await this.tec.moverPieza(c.id, { quitarDelKit: true });
      this.toast.success('La pieza salió del kit.');
      this.confirmQuitar.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo quitar del kit.');
    }
  }

  editar(): void {
    void this.router.navigate(['/tecnologia-inventario', this.id, 'editar']);
  }
  back(): void {
    this.location.back();
  }
}
