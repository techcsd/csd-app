import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { Onboarding } from '../../shared/components/onboarding/onboarding';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { MOTION_DIRECTIVES } from '../../shared/motion';
import { UserContextService } from '../../core/services/user-context.service';
import { BadgesService } from '../../core/services/badges.service';
import { EnProcesoService, EnProcesoItem } from '../../core/services/en-proceso.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { InventarioService } from '../../core/services/inventario.service';
import { ConducesService } from '../../core/services/conduces.service';
import { MensajesService } from '../../core/services/mensajes.service';
import { SyncService } from '../../core/sync/sync.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PushService } from '../../core/services/push.service';
import { ModuleOrderService, ModuleSize } from '../../core/services/module-order.service';
import { ToastService } from '../../core/services/toast.service';
import { fusionarEntregasPorRecibir } from '../../core/util/recepcion';
import { SupabaseService } from '../../core/services/supabase.service';
import { formatFechaRelativa } from '../../core/util/fecha';
import { PracticaService } from '../../core/practica/practica.service';

// A6 — "Hoy": resumen del tablero en vivo (RPC `tablero_vivo_resumen`, sin params).
// Esta app NO consume `flujo` ni `flota` (sin mapa ni pipeline de etapas — decisión
// explícita de batería/datos en el teléfono; eso vive solo en el tablero de la web).
interface TableroVivoKpis {
  requisiciones_hoy: number;
  conduces_hoy: number;
  entregas_hoy: number;
  echadas_hoy: number;
  vehiculos_en_uso: number;
  bitacoras_hoy: number;
}
interface TableroVivoEvento {
  tipo: 'requisicion' | 'conduce' | 'entrega' | 'combustible' | 'uso' | 'bitacora';
  titulo: string;
  detalle: string;
  at: string;
}
interface TableroVivoResumen {
  kpis: TableroVivoKpis;
  eventos: TableroVivoEvento[];
  generado_en: string;
}

export interface HomeTile {
  modulo: string;
  icon: string;
  label: string;
  route: string;
  tint: string;
}

/** DF4 (PROMPT 129) — fila de `sgc.pulso_obras_hoy()`, ya desplegado al Supabase de dev. */
interface PulsoObra {
  obra: string;
  reporto_hoy: boolean;
  dias_sin_reportar: number;
  estado: string;
}

// One button = one job. Gated by the same SGC module keys as the web.
export const TILES: HomeTile[] = [
  { modulo: 'bitacora', icon: '📓', label: 'Bitácora', route: '/bitacora', tint: '#1e3a5f' },
  { modulo: 'flota', icon: '🚚', label: 'Transporte', route: '/transporte', tint: '#f97316' },
  // AY11 — Ingeniería: concentra lo de ingenieros/producción (Solicitud de movimiento,
  // + submódulos futuros). Gateado por hasModulo('ingenieria').
  { modulo: 'ingenieria', icon: '📐', label: 'Ingeniería', route: '/ingenieria', tint: '#0369a1' },
  { modulo: 'inventario', icon: '📦', label: 'Inventario', route: '/inventario', tint: '#16a34a' },
  // AY3 — Requisición: el rol Ingenieros ORIGINA requisiciones por el submódulo
  // `compras.solicitudes` (ya no tiene el módulo `compras` completo). Gating especial
  // en workTiles (módulo O submódulo), no hasModulo a secas.
  { modulo: 'compras', icon: '🛒', label: 'Requisición', route: '/solicitudes', tint: '#2563eb' },
  // Y14/AY4 — Proyectos. El rol Ingenieros ve SUS obras por el submódulo
  // `proyectos.obras` (ya no tiene el módulo `proyectos` completo); admin/dirección/
  // gerencia lo conservan por módulo. Gating especial en workTiles (módulo O submódulo).
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
// FASE 4 — Compa (asistente de IA): general para todos (como Mensajes). Sin badge.
const COMPA_TILE: HomeTile = { modulo: 'compa', icon: '🤖', label: 'Compa', route: '/compa', tint: '#6d28d9' };
// AF39 — Tareas: general (el chofer ve las tareas asignadas a él aunque no tenga
// el módulo). El RPC mis_tareas_app acota la visibilidad.
const TAREAS_TILE: HomeTile = { modulo: 'tareas_app', icon: '✅', label: 'Tareas', route: '/tareas', tint: '#0d9488' };
// DG5 — "Demo": módulo GENERAL (todos, incl. choferes, como Notas): Misiones/Mi
// progreso/Escenarios del simulador de práctica (antes solo /practica, sin tile).
export const DEMO_TILE: HomeTile = { modulo: 'demo', icon: '🎓', label: 'Demo', route: '/demo', tint: '#f97316' };
// AH15 — consulta de "Compras del proyecto" para roles con acceso a proyectos
// (admin/proyectos/compras/obra — gerente de producción la aprovecha).
const COMPRAS_TILE: HomeTile = { modulo: 'compras_proyecto', icon: '💰', label: 'Compras de obra', route: '/compras-proyecto', tint: '#b45309' };
// AL8 — "Entregas por confirmar": entrada PERMANENTE para el confirmador (no solo
// el banner). Los de flota ya la tienen en el hub de Conduces; este tile la da a
// los confirmadores sin módulo flota (inventario/obra/almacén). Badge = pendientes.
const CONFIRMAR_TILE: HomeTile = { modulo: 'por_confirmar', icon: '📥', label: 'Por recibir', route: '/transporte/por-confirmar', tint: '#ca8a04' };
// AR1 — Personal de obra: registro en obra + consulta. Gating amplio (quienes
// pueden registrar/ver según la matriz): admin/proyectos/rrhh/dirección + capataz/
// ingeniero por su obra. La RLS acota los datos a la obra del usuario.
const PERSONAL_TILE: HomeTile = { modulo: 'personal_obra', icon: '🧑‍🔧', label: 'Personal de obra', route: '/proyectos/personal', tint: '#9333ea' };
// BH8 — Solicitud de compra a mano: para el equipo de Compras (Raykler). Distinta de
// "Requisición" (pedir material del almacén). Gating por el módulo `compras`.
const SOLCOMPRA_TILE: HomeTile = { modulo: 'solicitud_compra', icon: '🛍️', label: 'Solicitud de compra', route: '/compras/solicitud-compra', tint: '#b45309' };
// CO13 — Legal (expedientes + contratos). Gating por el módulo `legal` (Sonia/abogado,
// dirección, admin). CO12/CO13 — Documentos (generar/historial/plantillas): módulo
// `documentos` O `legal` (quien tiene Legal también genera/usa documentos).
const LEGAL_TILE: HomeTile = { modulo: 'legal', icon: '⚖️', label: 'Legal', route: '/legal', tint: '#7c2d12' };
const DOCUMENTOS_TILE: HomeTile = { modulo: 'documentos', icon: '📄', label: 'Documentos', route: '/documentos', tint: '#334155' };
// CP8 — Reuniones: módulo `reuniones` (gerencia/dirección/ingenieros/logística/legal/RRHH, admin).
const REUNIONES_TILE: HomeTile = { modulo: 'reuniones', icon: '🗓️', label: 'Reuniones', route: '/reuniones', tint: '#175cd3' };

// BC5/BD1 — agrupación del home por dominio (vista OPCIONAL, off por defecto). Cada
// tile conserva su gating/ruta/badge; solo cambia la PRESENTACIÓN (grupos). El orden
// de GROUPS es el de aparición; un grupo sin tiles visibles no se muestra. Cada
// módulo aparece UNA sola vez (sin fila "Para ti" que lo duplicaba).
interface HomeGroup {
  key: string;
  label: string;
  icon: string;
  color: string;
  modulos: string[]; // qué claves de tile caen en este grupo
}
// BD1 — Tareas/Mensajes/Notas/Compa NO son de Ingeniería: son GENERALES (un chofer
// ve Tareas porque es de todos). Van en su propia sección "General". El grupo de
// Ingeniería ya no arrastra `tareas_app`.
const GROUPS: HomeGroup[] = [
  { key: 'ingenieria', label: 'Ingeniería y producción', icon: '📐', color: '#2563eb',
    modulos: ['compras', 'ingenieria', 'bitacora', 'proyectos', 'obra', 'personal_obra', 'compras_proyecto', 'solicitud_compra'] },
  { key: 'transporte', label: 'Transporte', icon: '🚚', color: '#f97316',
    modulos: ['flota', 'por_confirmar'] },
  { key: 'inventario', label: 'Inventario', icon: '📦', color: '#16a34a',
    modulos: ['inventario'] },
  { key: 'general', label: 'General', icon: '💬', color: '#6d28d9',
    modulos: ['tareas_app', 'mensajes', 'notas', 'compa', 'demo'] },
  { key: 'administracion', label: 'Administración y sistema', icon: '⚙️', color: '#475569',
    modulos: ['admin', 'rrhh', 'tecnologia', 'sistema'] },
];
/** Grupo por defecto para cualquier tile que no esté mapeado arriba. */
const GRUPO_OTROS: HomeGroup = { key: 'otros', label: 'Otros', icon: '🗂️', color: '#475569', modulos: [] };

/** BC5 — un grupo del home ya resuelto: sus tiles visibles + su badge sumado. */
interface HomeGrupoRender extends HomeGroup {
  tiles: HomeTile[];
  badge: number | null;
}

// BH2 — módulos cuyo tile se retira del home de quien tiene `ingenieria` (viven en el
// hub /ingenieria). Coincide con el set del mock: Bitácora, Requisición, Mi obra,
// Por recibir, Personal de obra, Compras de obra. (Proyectos, Transporte e Inventario
// se QUEDAN en el home; los generales también.)
const MOVED_TO_INGENIERIA = new Set([
  'bitacora', 'obra', 'compras', 'por_confirmar', 'personal_obra', 'compras_proyecto',
]);

/**
 * Gating de un tile de trabajo por su módulo — con las excepciones que ya no
 * dependen del módulo padre completo (mismo criterio que sus route guards):
 * - obra (AG16): el capataz no tiene módulo padre, solo permisos `obra.*`.
 * - compras (AY3): el rol Ingenieros origina requisiciones por `compras.solicitudes`.
 * - proyectos (AY4): el rol Ingenieros ve sus obras por `proyectos.obras`.
 * Regla AU8/AY5: el menú y el guard leen la MISMA matriz (nada visible que dé 403).
 */
function esTileVisible(t: HomeTile, ctx: UserContextService): boolean {
  switch (t.modulo) {
    case 'obra':
      return ctx.puedeVerObra();
    case 'compras':
      return ctx.hasModulo('compras') || ctx.puedeVerSubmodulo('compras.solicitudes');
    case 'proyectos':
      return ctx.hasModulo('proyectos') || ctx.puedeVerSubmodulo('proyectos.obras');
    default:
      return ctx.hasModulo(t.modulo);
  }
}

/**
 * DG2 — todos los tiles de Home visibles para `ctx` (gateados, SIN ordenar — el
 * orden por drag&drop del admin es presentación, ver `aplicarOrden`). Función
 * PURA de módulo (no depende de un componente) para que el buscador compacto
 * (DG2) y el Home consuman el MISMO índice de navegación gateado — una sola
 * fuente de verdad, nunca una segunda lista que se desalinee (DG-08).
 */
export function visibleHomeTiles(ctx: UserContextService): HomeTile[] {
  // Tiles de trabajo: gateados por el módulo SGC del usuario (igual que la web).
  // AD6 — el chofer NO ve Inventario: sus funciones de inventario viven ahora en
  // Transporte (Recibir mercancía / Compra en ferretería).
  const work = TILES.filter((t) => esTileVisible(t, ctx) && !(t.modulo === 'inventario' && ctx.esChofer()));

  // AC4 — Notas es general (todos, incl. choferes). AF39 — Tareas también. AJ5 —
  // Mensajes también es general. DG5 — Demo también (práctica, para todos).
  const extra: HomeTile[] = [MENSAJES_TILE, COMPA_TILE, NOTAS_TILE, TAREAS_TILE, DEMO_TILE];
  // AH15 — Compras de obra: admin o roles con acceso a proyectos/compras/obra.
  if (ctx.esAdmin() || ctx.hasModulo('proyectos') || ctx.hasModulo('compras') || ctx.puedeVerObra()) {
    extra.push(COMPRAS_TILE);
  }
  // BH8 — Solicitud de compra a mano: el equipo de Compras (Raykler). Donde vive
  // quien la necesita; el ingeniero origina por Requisición, no por aquí.
  if (ctx.esAdmin() || ctx.hasModulo('compras')) {
    extra.push(SOLCOMPRA_TILE);
  }
  // AR1 — Personal de obra: quienes pueden registrar/ver (matriz). Los ingenieros/
  // capataces entran por su obra (puedeVerObra); la RLS acota los datos.
  if (
    ctx.esAdmin() ||
    ctx.hasModulo('proyectos') ||
    ctx.hasModulo('rrhh') ||
    ctx.hasModulo('direccion') ||
    ctx.puedeVerSubmodulo('proyectos.personal') ||
    ctx.puedeVerObra()
  ) {
    extra.push(PERSONAL_TILE);
  }
  // AL1 — "Sistema" (antes Tecnología): transversal, todos menos chofer.
  if (!ctx.esChofer()) {
    extra.push(SISTEMA_TILE);
  }
  // CO13 — Legal: módulo `legal` (Sonia/abogado, dirección, admin).
  if (ctx.esAdmin() || ctx.hasModulo('legal')) {
    extra.push(LEGAL_TILE);
  }
  // CO12/CO13 — Documentos: módulo `documentos` o `legal` (quien tiene Legal
  // también necesita generar/usar documentos — contratos salen de una plantilla).
  if (ctx.esAdmin() || ctx.hasModulo('documentos') || ctx.hasModulo('legal')) {
    extra.push(DOCUMENTOS_TILE);
  }
  // CP8 — Reuniones: módulo propio (ver sql/2026-10-16-cp8-reuniones.sql §3).
  if (ctx.esAdmin() || ctx.hasModulo('reuniones')) {
    extra.push(REUNIONES_TILE);
  }
  // AL8/AS7 — entrada permanente al confirmador sin módulo flota (los de flota la
  // tienen en el hub de Conduces). Se muestra SOLO a inventario/obra.
  if (!ctx.hasModulo('flota') && (ctx.hasModulo('inventario') || ctx.puedeVerObra())) {
    extra.push(CONFIRMAR_TILE);
  }
  // BH2 — TRASLADO PURO: quien tiene el módulo `ingenieria` accede a su trabajo
  // desde el hub /ingenieria, así que esos tiles se RETIRAN de su home.
  const all = [...work, ...extra];
  return ctx.hasModulo('ingenieria') ? all.filter((t) => !MOVED_TO_INGENIERIA.has(t.modulo)) : all;
}

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, EmptyState, SyncBar, Onboarding, ConfirmDialog, TranslatePipe, ...MOTION_DIRECTIVES],
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
  private autosave = inject(AutosaveService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private supabase = inject(SupabaseService);
  private practica = inject(PracticaService);
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
  // BD2 — entregas por RECIBIR: banner ÚNICO (fusiona "por firmar" AE + "por
  // confirmar" AJ8, deduplicado). El receptor puede ser un ingeniero/obra sin
  // módulo flota → banner de descubrimiento.
  porRecibir = signal(0);
  // DE4/A2.4 — transferencias de conduce que me ofrecieron (badge ya en el hub de
  // Conduces, AH5); se suma también al tile "Transporte" del Home para que no haga
  // falta entrar a Conduces para enterarse de que alguien te transfirió algo.
  transferenciasPendientes = signal(0);
  // BV5 — captura a medias (borrador con datos/foto sin enviar). Tarjeta "Pendiente
  // de terminar" que reabre la pantalla con el borrador. Muestra el más reciente.
  pendienteTerminar = signal<EnProcesoItem | null>(null);
  // AJ5 — mensajes no leídos (badge del tile de Mensajes).
  mensajesNoLeidos = signal(0);
  private primerSync = true;
  // QA-19: canal realtime de mensajes para mantener el badge de no leídos EN VIVO.
  private mensajesUnsub: (() => void) | null = null;

  // A6 — "Hoy": gate client-side ESPEJO del gate del RPC (42501 si no cumple) — evita
  // un round-trip inútil y decide si el bloque se muestra siquiera. Sin Realtime/mapa
  // (costo de batería/datos en el teléfono): polling fijo cada 30s, solo en foreground.
  hoyVisible = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('inventario') ||
      this.ctx.hasModulo('flota') ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('direccion'),
  );
  // BL2 — "no hay eventos hoy" (hoyResumen con eventos=[]) ≠ "la llamada falló"
  // (hoyFallo, solo cuando NUNCA hubo una carga exitosa — un poll fallido con datos
  // previos no tira el bloque, solo deja de refrescarlo esta vez).
  hoyResumen = signal<TableroVivoResumen | null>(null);
  hoyFallo = signal(false);

  // DF4 (PROMPT 129) — "Pulso de obras": anillo por obra, naranja mientras no
  // reportó hoy, verde al llegar. Dato de granularidad diaria — se carga una vez
  // por re-ingreso/resume (NO un polling de 30s como "Hoy", sería desperdiciar
  // batería/datos para algo que solo cambia una vez al día por obra).
  pulsoObrasVisible = computed(() => this.ctx.hasModulo('proyectos') || this.ctx.esFlotaElevado());
  pulsoObras = signal<PulsoObra[] | null>(null);
  // DG5 — insignia del tile "Demo": misiones pendientes por aprobar (del rol propio).
  demoPendientes = signal<number | null>(null);

  private hoyInterval: ReturnType<typeof setInterval> | null = null;
  private hoyResumeHandle: PluginListenerHandle | null = null;
  private hoyPauseHandle: PluginListenerHandle | null = null;
  private pulsoObrasResumeHandle: PluginListenerHandle | null = null;
  private badgesResumeHandle: PluginListenerHandle | null = null;
  private static readonly HOY_POLL_MS = 30000;
  private static readonly ICONOS_EVENTO: Record<TableroVivoEvento['tipo'], string> = {
    requisicion: '🛒',
    conduce: '📦',
    entrega: '📥',
    combustible: '⛽',
    uso: '🔑',
    bitacora: '📓',
  };

  // AC2 — Tecnología es pública para TODOS excepto el rol chofer. No se gatea por
  // el módulo 'tecnologia' (que solo tienen admin/tecnología) sino por !esChofer,
  // así lo ven también dirección/gerencia/jefes/ingenieros. El contenido
  // restringido (Versiones/Errores) sigue gateado por rol dentro de la página.
  // El contenido transversal (Dudas/guías, visitar web) está en el footer para
  // todos, incluidos los choferes.
  // DG2 — extraída a `visibleHomeTiles` (función pura, módulo) para que el
  // buscador compacto indexe EXACTAMENTE el mismo conjunto gateado, sin una
  // segunda lista (DG-08): una sola fuente de verdad para Home y el buscador.
  tiles = computed(() => this.aplicarOrden(visibleHomeTiles(this.ctx)));

  /**
   * BC5 — reparte los tiles visibles (ya gateados y ordenados) en los grupos por
   * dominio. Conserva el orden dentro de cada grupo (respeta el orden del admin,
   * AF38). Un grupo sin tiles no se muestra. El badge del grupo suma los de sus
   * tiles (AU6c) sin quitar el badge por tile.
   */
  grupos = computed<HomeGrupoRender[]>(() => {
    const all = this.tiles();
    const claveDe = new Map<string, string>();
    for (const g of GROUPS) for (const m of g.modulos) claveDe.set(m, g.key);
    const buckets = new Map<string, HomeTile[]>();
    for (const t of all) {
      const gk = claveDe.get(t.modulo) ?? GRUPO_OTROS.key;
      const arr = buckets.get(gk) ?? [];
      arr.push(t);
      buckets.set(gk, arr);
    }
    const defs = [...GROUPS, GRUPO_OTROS];
    const out: HomeGrupoRender[] = [];
    for (const g of defs) {
      const tiles = buckets.get(g.key) ?? [];
      if (!tiles.length) continue;
      const badge = tiles.reduce((sum, t) => sum + (this.badgeFor(t.modulo) ?? 0), 0);
      out.push({ ...g, tiles, badge: badge || null });
    }
    return out;
  });

  // BD1 — ¿mostrar el home AGRUPADO? Preferencia por usuario (server-side), OFF por
  // defecto: el default es el grid plano. La vista agrupada es opcional.
  agruparHome = this.ctx.agruparHome;

  // BD1 — secciones colapsables (para acortar el scroll en la vista agrupada). El
  // estado se guarda por dispositivo (localStorage): recordar qué grupos plegó el
  // usuario es una comodidad local, no un dato de negocio.
  private static readonly COLAPSADOS_KEY = 'home_grupos_colapsados';
  colapsados = signal<Set<string>>(new Set(this.leerColapsados()));

  private leerColapsados(): string[] {
    try {
      const raw = localStorage.getItem(HomePage.COLAPSADOS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  grupoColapsado(key: string): boolean {
    return this.colapsados().has(key);
  }

  toggleGrupo(key: string): void {
    this.colapsados.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(HomePage.COLAPSADOS_KEY, JSON.stringify([...next]));
      } catch {
        /* best-effort */
      }
      return next;
    });
  }

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
    // BV5 — la captura a medias más reciente (borrador) para la tarjeta "Pendiente de terminar".
    void this.cargarPendienteTerminar();
    // BD2 — cuántas entregas me quedan por recibir (fusión firmar+confirmar).
    void this.cargarPorRecibir();
    // DE4/A2.4 — transferencias de conduce ofrecidas a mí (badge del tile Transporte).
    void this.conduces
      .misTransferenciasPendientes()
      .then((l) => this.transferenciasPendientes.set(l.length))
      .catch(() => {});
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
    // A6 — "Hoy": primera carga + arranca el polling si el gate lo permite; el
    // foreground/background lo maneja iniciarPollingHoy/detenerPollingHoy.
    if (this.hoyVisible()) {
      void this.cargarHoy();
      this.iniciarPollingHoy();
    }
    void this.cargarPulsoObras();
    void this.cargarDemoPendientes();
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('pause', () => this.detenerPollingHoy()).then((h) => (this.hoyPauseHandle = h));
      void CapApp.addListener('resume', () => {
        if (!this.hoyVisible()) return;
        void this.cargarHoy();
        this.iniciarPollingHoy();
      }).then((h) => (this.hoyResumeHandle = h));
      void CapApp.addListener('resume', () => void this.cargarPulsoObras()).then((h) => (this.pulsoObrasResumeHandle = h));
      // DE3/A1 — recuenta badges al volver a primer plano (AM2): si algo cambió
      // mientras la app estaba en background (otro recibió/despachó), el número
      // del icono no debe quedar viejo hasta que el usuario reabra el Home.
      void CapApp.addListener('resume', () => {
        void this.badges.load();
        void this.conduces
          .misTransferenciasPendientes()
          .then((l) => this.transferenciasPendientes.set(l.length))
          .catch(() => {});
      }).then((h) => (this.badgesResumeHandle = h));
    }
    document.addEventListener('visibilitychange', this.onHoyVisibilityChange);
    effect(() => {
      this.sync.changed();
      if (this.primerSync) {
        this.primerSync = false;
        return;
      }
      if (this.sync.pendingCount() === 0) {
        void this.cargarPorRecibir();
        void this.badges.load(); // DE3/A1 — recuenta al drenar el outbox (algo se envió)
        void this.conduces
          .misTransferenciasPendientes()
          .then((l) => this.transferenciasPendientes.set(l.length))
          .catch(() => {});
      }
      void this.cargarPendienteTerminar(); // BV5 — refresca al drenar/encolar/descartar
    });
  }

  /** BV5 — carga el borrador (captura a medias) más reciente para la tarjeta del home. */
  private async cargarPendienteTerminar(): Promise<void> {
    try {
      const all = await this.enProceso.listAll();
      this.pendienteTerminar.set(all.find((i) => i.kind === 'borrador') ?? null);
    } catch {
      /* best-effort */
    }
  }

  /** CT5 — confirmación antes de descartar el borrador desde el banner del home
   *  (mismo patrón que EnProcesoPage.pedirDescartar/descartar). */
  confirmarDescartePendiente = signal(false);
  pedirDescartarPendiente(): void {
    this.confirmarDescartePendiente.set(true);
  }
  cancelarDescartePendiente(): void {
    this.confirmarDescartePendiente.set(false);
  }
  async descartarPendiente(): Promise<void> {
    this.confirmarDescartePendiente.set(false);
    const b = this.pendienteTerminar();
    if (!b) return;
    await this.autosave.discard(b.id); // b.id = clave del borrador
    this.pendienteTerminar.set(null);
    this.toast.show(this.i18n.t('Borrador descartado.'), 'info');
  }

  /** BV5 — reabre la pantalla con el borrador (mirror de EnProcesoPage.retomar). */
  abrirPendiente(): void {
    const b = this.pendienteTerminar();
    if (!b?.ruta) {
      void this.router.navigate(['/en-proceso']);
      return;
    }
    const [path] = b.ruta.split('?');
    if (b.resumePorClave) {
      void this.router.navigate([path], { queryParams: { borrador: b.id } });
    } else {
      void this.router.navigateByUrl(b.ruta);
    }
  }

  ngOnDestroy(): void {
    // QA-19: cierra el canal realtime de mensajes al salir del Home.
    this.mensajesUnsub?.();
    this.clearLongPress();
    // A6 — para el polling y suelta los listeners de foreground al salir del Home.
    this.detenerPollingHoy();
    void this.hoyPauseHandle?.remove();
    void this.hoyResumeHandle?.remove();
    void this.badgesResumeHandle?.remove();
    void this.pulsoObrasResumeHandle?.remove();
    document.removeEventListener('visibilitychange', this.onHoyVisibilityChange);
  }

  /** A6 — PWA: visibilitychange cubre lo que `App.addListener` (solo nativo) no ve. */
  private readonly onHoyVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.cargarPulsoObras();
    if (!this.hoyVisible()) return;
    if (document.visibilityState === 'visible') {
      void this.cargarHoy();
      this.iniciarPollingHoy();
    } else {
      this.detenerPollingHoy();
    }
  };

  /** A6 — carga el resumen del tablero (best-effort, nice-to-have, nunca rompe el Home). */
  private async cargarHoy(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('tablero_vivo_resumen');
      if (error) throw error;
      this.hoyResumen.set(data as TableroVivoResumen);
      this.hoyFallo.set(false);
    } catch {
      // Un poll fallido con datos previos no los borra (evita parpadear a "falló" por
      // un blip de red); solo marca fallo si NUNCA hubo una carga exitosa.
      if (!this.hoyResumen()) this.hoyFallo.set(true);
    }
  }

  /** DF4 — best-effort, nice-to-have, nunca rompe el Home. */
  private async cargarPulsoObras(): Promise<void> {
    if (!this.pulsoObrasVisible()) return;
    try {
      const { data, error } = await this.supabase.client.rpc('pulso_obras_hoy');
      if (error) throw error;
      this.pulsoObras.set(data as PulsoObra[]);
    } catch {
      /* best-effort — el widget simplemente no aparece esta vez */
    }
  }

  /** DG5 — insignia del tile "Demo": cuántas misiones (de las suyas por rol) le
   *  quedan por aprobar. Best-effort: si falla, el tile queda sin número. */
  private async cargarDemoPendientes(): Promise<void> {
    try {
      const visibles = this.practica.misionesVisibles();
      const intentos = await this.practica.misResultados();
      const aprobadas = new Set(intentos.filter((i) => i.aprobada).map((i) => i.mision_id));
      const pendientes = visibles.filter((m) => !aprobadas.has(m.id)).length;
      this.demoPendientes.set(pendientes || null);
    } catch {
      /* best-effort — el tile simplemente queda sin insignia esta vez */
    }
  }

  private iniciarPollingHoy(): void {
    this.detenerPollingHoy();
    this.hoyInterval = setInterval(() => void this.cargarHoy(), HomePage.HOY_POLL_MS);
  }

  private detenerPollingHoy(): void {
    if (this.hoyInterval != null) {
      clearInterval(this.hoyInterval);
      this.hoyInterval = null;
    }
  }

  /** A6 — glyph del tipo de evento (TS-bound, nunca emoji literal en la plantilla). */
  iconoEvento(tipo: TableroVivoEvento['tipo']): string {
    return HomePage.ICONOS_EVENTO[tipo] ?? '•';
  }

  /** A6 — "hace X min/h" reutilizando el util de fecha ya existente en la app. */
  tiempoEvento(at: string): string {
    return formatFechaRelativa(at);
  }

  /** QA-19 — recuenta los mensajes no leídos y actualiza el badge (best-effort). */
  private recontarNoLeidos(): void {
    void this.mensajes
      .contarNoLeidos()
      .then((n) => this.mensajesNoLeidos.set(n))
      .catch(() => {});
  }

  /** BD2 — total deduplicado de entregas por recibir (firmar + confirmar). */
  private async cargarPorRecibir(): Promise<void> {
    try {
      const [confirmar, firmar] = await Promise.all([
        this.conduces.misEntregasPorConfirmar(),
        this.inventario.misFirmasPendientes(),
      ]);
      this.porRecibir.set(fusionarEntregasPorRecibir(confirmar, firmar).length);
    } catch {
      /* best-effort */
    }
  }

  irPorRecibir(): void {
    void this.router.navigate(['/transporte/por-confirmar']);
  }

  avisos(): void {
    void this.router.navigate(['/avisos']);
  }

  // DG2 — lupa de la cabecera → buscador compacto (pantalla completa).
  buscar(): void {
    void this.router.navigate(['/buscador']);
  }

  /** Q2/DE3 — badge del tile = pendientes de aprobación del servidor, por módulo
   *  (`badges_modulos_app`, por usuario). Los borradores locales sin enviar YA NO
   *  se suman aquí: viven en su propia fila "Pendiente de terminar"/`/en-proceso`
   *  (EnProcesoService) para que el número del icono siempre cuadre con lo que el
   *  módulo lista al entrar — antes sumar ambos producía un total que no coincidía
   *  con ninguna lista real (DE3). */
  badgeFor(modulo: string): number | null {
    if (modulo === 'mensajes') return this.mensajesNoLeidos() || null;
    if (modulo === 'por_confirmar') return this.porRecibir() || null; // BD2
    // DE4 — Transporte suma las transferencias de conduce que me ofrecieron (antes
    // solo visibles entrando al hub de Conduces; el deep-link del push aterriza
    // aquí, no en Conduces, así que el tile debe mostrarlo sin tener que entrar).
    if (modulo === 'flota') return (this.badgeCounts()['flota'] ?? 0) + this.transferenciasPendientes() || null;
    if (modulo === 'demo') return this.demoPendientes(); // DG5 — misiones pendientes
    return this.badgeCounts()[modulo] || null;
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
