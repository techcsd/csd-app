import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppLauncher } from '@capacitor/app-launcher';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { Onboarding } from '../../shared/components/onboarding/onboarding';
import { UserContextService } from '../../core/services/user-context.service';
import { BadgesService } from '../../core/services/badges.service';
import { EnProcesoService } from '../../core/services/en-proceso.service';
import { InventarioService } from '../../core/services/inventario.service';
import { ConducesService } from '../../core/services/conduces.service';
import { MensajesService } from '../../core/services/mensajes.service';
import { SyncService } from '../../core/sync/sync.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PushService } from '../../core/services/push.service';
import { ModuleOrderService, ModuleSize } from '../../core/services/module-order.service';
import { ToastService } from '../../core/services/toast.service';

interface HomeTile {
  modulo: string;
  icon: string;
  label: string;
  route: string;
  tint: string;
}

// One button = one job. Gated by the same SGC module keys as the web.
const TILES: HomeTile[] = [
  { modulo: 'bitacora', icon: '📓', label: 'Bitácora', route: '/bitacora', tint: '#1e3a5f' },
  { modulo: 'flota', icon: '🚚', label: 'Transporte', route: '/transporte', tint: '#f97316' },
  // AY11 — Ingeniería: concentra lo de ingenieros/producción (Solicitud de movimiento,
  // + submódulos futuros). Gateado por hasModulo('ingenieria').
  { modulo: 'ingenieria', icon: '📐', label: 'Ingeniería', route: '/ingenieria', tint: '#0369a1' },
  { modulo: 'inventario', icon: '📦', label: 'Inventario', route: '/inventario', tint: '#16a34a' },
  { modulo: 'compras', icon: '🛒', label: 'Requisición', route: '/solicitudes', tint: '#2563eb' },
  // Y14 — Proyectos (gateado por módulo proyectos: admin/direccion/gerencia/
  // gerente_proyectos/ingeniero_oficina). Los responsables sin módulo llegan al
  // cronograma por deep-link de aviso (FASE 5).
  { modulo: 'proyectos', icon: '🏗️', label: 'Proyectos', route: '/proyectos', tint: '#0d9488' },
  // AG16 — Gestión de Producción de Obra (gerente_produccion / capataz). El capataz
  // no tiene módulo padre (solo permisos obra.*), así que su gating es especial
  // (puedeVerObra) en workTiles, no hasModulo.
  { modulo: 'obra', icon: '🦺', label: 'Mi obra', route: '/obra', tint: '#0f766e' },
  // AH16 — RRHH (jefe de RRHH): empleados + asignaciones AF33. Gating por hasModulo('rrhh').
  { modulo: 'rrhh', icon: '🧑‍💼', label: 'RRHH', route: '/rrhh/empleados', tint: '#7c3aed' },
  { modulo: 'admin', icon: '⚙️', label: 'Administración', route: '/admin', tint: '#3f3f46' },
  // AL1/AL2 — Tecnología REAL = inventario tecnológico (activos de TI). Gating por
  // módulo `tecnologia` (admin + rol Tecnología). El módulo viejo (versiones/dudas/
  // errores) se renombró a "Sistema" (SISTEMA_TILE).
  { modulo: 'tecnologia', icon: '💻', label: 'Tecnología', route: '/tecnologia-inventario', tint: '#0891b2' },
];

// AL1 — "Sistema": lo que ANTES se llamaba Tecnología (Historial de versiones,
// Dudas/guías, Reportes de error). Es transversal (no un módulo de trabajo): se
// muestra a todos menos al chofer, como antes. El contenido restringido
// (Versiones/Errores) sigue gateado por rol dentro de la propia página.
const SISTEMA_TILE: HomeTile = { modulo: 'sistema', icon: '🛠️', label: 'Sistema', route: '/tecnologia', tint: '#475569' };

// AC4 — Notas: módulo GENERAL accesible por TODOS (incluidos choferes), como
// Mensajes. No se gatea por módulo SGC; se muestra siempre.
const NOTAS_TILE: HomeTile = { modulo: 'notas', icon: '🗒️', label: 'Notas', route: '/notas', tint: '#7c3aed' };
// AJ5 — Mensajes: general (todos los roles, como en la web). Badge de no leídos.
const MENSAJES_TILE: HomeTile = { modulo: 'mensajes', icon: '💬', label: 'Mensajes', route: '/mensajes', tint: '#2563eb' };
// AF39 — Tareas: general (el chofer ve las tareas asignadas a él aunque no tenga
// el módulo). El RPC mis_tareas_app acota la visibilidad.
const TAREAS_TILE: HomeTile = { modulo: 'tareas_app', icon: '✅', label: 'Tareas', route: '/tareas', tint: '#0d9488' };
// AH15 — consulta de "Compras del proyecto" para roles con acceso a proyectos
// (admin/proyectos/compras/obra — gerente de producción la aprovecha).
const COMPRAS_TILE: HomeTile = { modulo: 'compras_proyecto', icon: '💰', label: 'Compras de obra', route: '/compras-proyecto', tint: '#b45309' };
// AL8 — "Entregas por confirmar": entrada PERMANENTE para el confirmador (no solo
// el banner). Los de flota ya la tienen en el hub de Conduces; este tile la da a
// los confirmadores sin módulo flota (inventario/obra/almacén). Badge = pendientes.
const CONFIRMAR_TILE: HomeTile = { modulo: 'por_confirmar', icon: '📥', label: 'Por confirmar', route: '/transporte/por-confirmar', tint: '#ca8a04' };
// AR1 — Personal de obra: registro en obra + consulta. Gating amplio (quienes
// pueden registrar/ver según la matriz): admin/proyectos/rrhh/dirección + capataz/
// ingeniero por su obra. La RLS acota los datos a la obra del usuario.
const PERSONAL_TILE: HomeTile = { modulo: 'personal_obra', icon: '🧑‍🔧', label: 'Personal de obra', route: '/proyectos/personal', tint: '#9333ea' };

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, EmptyState, SyncBar, Onboarding],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage implements OnDestroy {
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private badges = inject(BadgesService);
  private enProceso = inject(EnProcesoService);
  private inventario = inject(InventarioService);
  private conduces = inject(ConducesService);
  private mensajes = inject(MensajesService);
  private sync = inject(SyncService);
  private notificaciones = inject(NotificacionesService);
  private push = inject(PushService);
  private moduleOrder = inject(ModuleOrderService);
  private toast = inject(ToastService);
  avisosNoLeidos = this.notificaciones.noLeidas;

  // AF38 — orden de módulos configurable por el admin (drag & drop tipo launcher).
  esAdmin = this.ctx.esAdmin;
  // AJ4 — personalizar layout es un permiso DELEGABLE (no solo admin).
  puedeEditarLayout = computed(
    () => this.ctx.esAdmin() || this.ctx.puedeOperarSubmodulo('plataforma.layout_app'),
  );
  orderMap = signal<Record<string, number>>({});
  sizeMap = signal<Record<string, ModuleSize>>({}); // AJ4 — tamaño por módulo
  editMode = signal(false);
  editTiles = signal<HomeTile[]>([]);
  editSizes = signal<Record<string, ModuleSize>>({}); // AJ4 — tamaños en edición
  dragIndex = signal<number | null>(null);
  private lpTimer: ReturnType<typeof setTimeout> | null = null;

  nombre = this.ctx.nombre;
  obra = this.ctx.obraActiva;
  badgeCounts = this.badges.counts; // Q2 — pendientes por módulo
  enProcesoCounts = this.enProceso.counts; // V1 — borradores/envíos por módulo
  // AE — firmas de recepción PENDIENTES asignadas a mí (banner de descubrimiento,
  // porque un ingeniero receptor puede no tener el módulo flota).
  firmasPendientes = signal(0);
  // AJ8 — entregas que YO debo confirmar como receptor (banner de descubrimiento:
  // el receptor puede ser inventario/obra sin módulo flota).
  porConfirmar = signal(0);
  // AJ5 — mensajes no leídos (badge del tile de Mensajes).
  mensajesNoLeidos = signal(0);
  private primerSync = true;
  // QA-19: canal realtime de mensajes para mantener el badge de no leídos EN VIVO.
  private mensajesUnsub: (() => void) | null = null;

  // Tiles de trabajo: gateados por el módulo SGC del usuario (igual que la web).
  // Tecnología se excluye de aquí porque NO es un módulo de trabajo (ver `tiles`).
  // AD6 — el chofer NO ve Inventario: sus funciones de inventario viven ahora en
  // Transporte (Recibir mercancía / Compra en ferretería). El acceso temporal al
  // módulo se revierte en SGC tras publicar esta versión; aquí ya lo ocultamos.
  private workTiles = computed(() =>
    TILES.filter(
      (t) =>
        // AG16 — obra: gating por submódulos (el capataz no tiene módulo padre).
        (t.modulo === 'obra' ? this.ctx.puedeVerObra() : this.ctx.hasModulo(t.modulo)) &&
        !(t.modulo === 'inventario' && this.ctx.esChofer()),
    ),
  );

  // AC2 — Tecnología es pública para TODOS excepto el rol chofer. No se gatea por
  // el módulo 'tecnologia' (que solo tienen admin/tecnología) sino por !esChofer,
  // así lo ven también dirección/gerencia/jefes/ingenieros. El contenido
  // restringido (Versiones/Errores) sigue gateado por rol dentro de la página.
  // El contenido transversal (Dudas/guías, visitar web) está en el footer para
  // todos, incluidos los choferes.
  tiles = computed(() => {
    const work = this.workTiles();
    // AC4 — Notas es general (todos, incl. choferes). AF39 — Tareas también.
    // AJ5 — Mensajes también es general. Tecnología, todos menos chofer.
    const extra: HomeTile[] = [MENSAJES_TILE, NOTAS_TILE, TAREAS_TILE];
    // AH15 — Compras de obra: admin o roles con acceso a proyectos/compras/obra.
    if (this.ctx.esAdmin() || this.ctx.hasModulo('proyectos') || this.ctx.hasModulo('compras') || this.ctx.puedeVerObra()) {
      extra.push(COMPRAS_TILE);
    }
    // AR1 — Personal de obra: quienes pueden registrar/ver (matriz). Los ingenieros/
    // capataces entran por su obra (puedeVerObra); la RLS acota los datos.
    if (
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('rrhh') ||
      this.ctx.hasModulo('direccion') ||
      this.ctx.puedeVerSubmodulo('proyectos.personal') ||
      this.ctx.puedeVerObra()
    ) {
      extra.push(PERSONAL_TILE);
    }
    // AL1 — "Sistema" (antes Tecnología): transversal, todos menos chofer.
    if (!this.ctx.esChofer()) {
      extra.push(SISTEMA_TILE);
    }
    // AL8/AS7 — entrada permanente al confirmador sin módulo flota (los de flota la
    // tienen en el hub de Conduces). Se muestra SOLO a inventario/obra. Antes bastaba
    // con `porConfirmar()>0`, lo que colaba el tile en el home de un usuario SIN rol
    // que resultara ser receptor: ahora ese caso se atiende con la BANNER accionable
    // ("Tienes N por confirmar") de arriba — el home queda limpio.
    if (!this.ctx.hasModulo('flota') && (this.ctx.hasModulo('inventario') || this.ctx.puedeVerObra())) {
      extra.push(CONFIRMAR_TILE);
    }
    return this.aplicarOrden([...work, ...extra]); // AF38
  });

  /** AF38 — aplica el orden configurado por el admin; los no configurados quedan
   *  después, en su orden por defecto. El gating por rol ya se aplicó (workTiles). */
  private aplicarOrden(all: HomeTile[]): HomeTile[] {
    const order = this.orderMap();
    const idx = new Map(all.map((t, i) => [t.modulo, i]));
    return [...all].sort((a, b) => {
      const oa = order[a.modulo] ?? 1000 + (idx.get(a.modulo) ?? 0);
      const ob = order[b.modulo] ?? 1000 + (idx.get(b.modulo) ?? 0);
      return oa - ob;
    });
  }

  constructor() {
    // AK12 — arranque SIEMPRE en Home. Se elimina el auto-entrar de usuarios
    // mono-módulo: para un chofer (único módulo = flota) eso abría Transporte
    // solo en cada arranque en frío. Ahora solo una push tapeada navega
    // (deep-link explícito por push.service, que pasa por el nav-guard).
    // Q2 — badges de pendientes por módulo (best-effort, online).
    void this.badges.load();
    // V1 — contador de documentación en proceso (local, offline).
    void this.enProceso.refresh();
    // AE — cuántas firmas de recepción me quedan por firmar (recarga al drenar).
    void this.cargarFirmasPendientes();
    // AJ8 — cuántas entregas debo confirmar como receptor.
    void this.cargarPorConfirmar();
    // AJ5 — mensajes no leídos (badge del tile de Mensajes).
    this.recontarNoLeidos();
    // QA-19: badge EN VIVO — recuenta en cada INSERT de mensajes (antes solo se
    // actualizaba al re-entrar al Home). Canal propio; se cierra en ngOnDestroy.
    this.mensajesUnsub = this.mensajes.suscribir(() => this.recontarNoLeidos());
    // AE — avisos no leídos (badge de la campana). Best-effort, online.
    void this.notificaciones.refreshNoLeidas();
    // AF7 — ya hay sesión: registra/renueva el token push del usuario (native only).
    void this.push.syncToken();
    // AF38 — orden de módulos configurado (cache-then-network).
    void this.cargarOrden();
    effect(() => {
      this.sync.changed();
      if (this.primerSync) {
        this.primerSync = false;
        return;
      }
      if (this.sync.pendingCount() === 0) {
        void this.cargarFirmasPendientes();
        void this.cargarPorConfirmar();
      }
    });
  }

  ngOnDestroy(): void {
    // QA-19: cierra el canal realtime de mensajes al salir del Home.
    this.mensajesUnsub?.();
    this.clearLongPress();
  }

  /** QA-19 — recuenta los mensajes no leídos y actualiza el badge (best-effort). */
  private recontarNoLeidos(): void {
    void this.mensajes
      .contarNoLeidos()
      .then((n) => this.mensajesNoLeidos.set(n))
      .catch(() => {});
  }

  private async cargarFirmasPendientes(): Promise<void> {
    try {
      this.firmasPendientes.set((await this.inventario.misFirmasPendientes()).length);
    } catch {
      /* best-effort */
    }
  }

  private async cargarPorConfirmar(): Promise<void> {
    try {
      this.porConfirmar.set(await this.conduces.entregasPorConfirmarCount());
    } catch {
      /* best-effort */
    }
  }

  irPorFirmar(): void {
    void this.router.navigate(['/transporte/por-firmar']);
  }

  irPorConfirmar(): void {
    void this.router.navigate(['/transporte/por-confirmar']);
  }

  avisos(): void {
    void this.router.navigate(['/avisos']);
  }

  /** Q2+V1 — badge del tile = pendientes de aprobación + documentación en proceso. */
  badgeFor(modulo: string): number | null {
    if (modulo === 'mensajes') return this.mensajesNoLeidos() || null;
    if (modulo === 'por_confirmar') return this.porConfirmar() || null; // AL8
    const total = (this.badgeCounts()[modulo] ?? 0) + (this.enProcesoCounts()[modulo] ?? 0);
    return total || null;
  }

  open(tile: HomeTile): void {
    if (this.editMode()) return; // AF38 — en modo edición no se navega
    void this.router.navigate([tile.route]);
  }

  // ── AF38 — orden de módulos (drag & drop, solo admin) ──────────────────────
  private async cargarOrden(): Promise<void> {
    try {
      const rows = await this.moduleOrder.getOrder();
      const map: Record<string, number> = {};
      const sizes: Record<string, ModuleSize> = {};
      for (const r of rows) {
        if (r.parent) continue;
        map[r.clave] = r.orden;
        sizes[r.clave] = r.size;
      }
      this.orderMap.set(map);
      this.sizeMap.set(sizes);
    } catch {
      /* best-effort: sin orden guardado, se usa el por defecto */
    }
  }

  /** AJ4 — clase de tamaño del tile (1x1 por defecto). */
  sizeClass(modulo: string): ModuleSize {
    return this.sizeMap()[modulo] ?? '1x1';
  }

  /** Long-press para entrar en modo edición (admin o permiso delegable AJ4). */
  onTilePointerDown(): void {
    if (!this.puedeEditarLayout() || this.editMode()) return;
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
    this.editSizes.set({ ...this.sizeMap() });
    this.editMode.set(true);
  }

  /** AJ4 — cicla el tamaño de un tile: 1x1 → 2x1 → 2x2 → 1x1. */
  cycleSize(modulo: string, ev: Event): void {
    ev.stopPropagation();
    const next: Record<ModuleSize, ModuleSize> = { '1x1': '2x1', '2x1': '2x2', '2x2': '1x1' };
    this.editSizes.update((m) => ({ ...m, [modulo]: next[m[modulo] ?? '1x1'] }));
  }

  editSizeOf(modulo: string): ModuleSize {
    return this.editSizes()[modulo] ?? '1x1';
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
    const sizes = this.editSizes();
    const items = this.editTiles().map((t, i) => ({
      clave: t.modulo,
      orden: i,
      size: sizes[t.modulo] ?? ('1x1' as ModuleSize),
    }));
    const map: Record<string, number> = {};
    const smap: Record<string, ModuleSize> = {};
    items.forEach((it) => {
      map[it.clave] = it.orden;
      smap[it.clave] = it.size;
    });
    this.orderMap.set(map); // optimista: el home ya refleja el nuevo orden…
    this.sizeMap.set(smap); // …y los tamaños
    this.editMode.set(false);
    try {
      await this.moduleOrder.setOrder(items);
      this.toast.success('Módulos guardados.');
    } catch {
      this.toast.error('No se pudo guardar. Inténtalo de nuevo.');
    }
  }
  cancelarOrden(): void {
    this.editMode.set(false);
    this.dragIndex.set(null);
  }

  perfil(): void {
    void this.router.navigate(['/perfil']);
  }

  reportar(): void {
    void this.router.navigate(['/reportar']);
  }

  /** AA6 — Dudas como entrada principal: abre Tecnología en la pestaña Dudas. */
  dudas(): void {
    void this.router.navigate(['/tecnologia'], { queryParams: { tab: 'dudas' } });
  }

  /** AA7 — abrir la página web (SGC) en el navegador del sistema. */
  async visitarWeb(): Promise<void> {
    const url = 'https://sgcconstructorasd.com';
    try {
      await AppLauncher.openUrl({ url });
    } catch {
      window.open(url, '_system');
    }
  }
}
