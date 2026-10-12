import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { VersionService, VersionHistorial, CAMBIO_LABEL } from '../../core/services/version.service';
import { ErrorReportService, AppErrorReportRow } from '../../core/services/error-report.service';
import { NetworkService } from '../../core/services/network.service';
import { UserContextService } from '../../core/services/user-context.service';
import { AyudaService } from '../../core/services/ayuda.service';
import { DudaCategoria, GuiaVisual, GuiaVideoFirmado } from '../../core/models/ayuda.model';
import { VideoPlayerService } from '../../shared/ui/video-player/video-player.service';
import { ToastService } from '../../core/services/toast.service';
import { Share } from '@capacitor/share';
import { environment } from '../../../environments/environment';
import { formatFechaMedia } from '../../core/util/fecha';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';

type Tab = 'versiones' | 'dudas' | 'errores';

// Z30 — mapa de icono corto → emoji para las guías visuales.
const GUIA_ICONO: Record<GuiaVisual['icono'], string> = {
  preuso: '📝',
  combustible: '⛽',
  conduce: '🧾',
  bitacora: '📓',
  inventario: '📦',
};

/**
 * Y11-app — Sección "Tecnología" (gateada por módulo `tecnologia`: admin +
 * Tecnología/Encargado de Tecnología). Muestra: versión instalada + aviso de
 * nueva, historial de versiones de la app (reutiliza `VersionService.historial`,
 * misma fuente que la web) y una vista compacta de reportes de errores (Y6) para
 * diagnóstico en campo (RLS `es_tecnologia()`).
 */
@Component({
  selector: 'app-tecnologia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, JsonPipe, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './tecnologia.html',
  styleUrl: './tecnologia.scss',
})
export class TecnologiaPage {
  private version = inject(VersionService);
  private errores = inject(ErrorReportService);
  private network = inject(NetworkService);
  private location = inject(Location);
  private ctx = inject(UserContextService);
  private ayuda = inject(AyudaService);
  private router = inject(Router);
  private videoPlayer = inject(VideoPlayerService);
  private toast = inject(ToastService);

  readonly cambioLabel = CAMBIO_LABEL;
  readonly guiaIcono = GUIA_ICONO;
  readonly instalada = environment.version;

  // Z26 — "Reportes de errores" solo para admin/tecnologia/gerencia/direccion
  // (RLS es_tecnologia()). El resto de Tecnología (Historial de versiones + Dudas)
  // lo ve todo usuario.
  esTecnologia = this.ctx.esTecnologia;
  // BX1 — Dev notes van por es_rol_desarrollador (incluye el rol Developer y
  // encargado_tecnologia; NO gerencia/direccion). Espejo del gate del padre: la RLS
  // de notas ambito='dev' usa es_rol_desarrollador, no es_tecnologia.
  esDesarrollador = this.ctx.esDesarrollador;

  // Z30 — Dudas (mismo contenido que la web, desde sgc.ayuda_contenido).
  private dudasCargadas = false;
  guias = signal<GuiaVisual[]>([]);
  categorias = signal<DudaCategoria[]>([]);
  dudasQuery = signal('');
  expandidaDuda = signal<string | null>(null);
  // CK5 — URLs firmadas del video de cada guía (por id). La clave presente con
  // valor null = "se intentó firmar y falló" (para no quedar en "Cargando…").
  private videos = signal<Record<string, GuiaVideoFirmado | null>>({});

  private canVerModulo(modulo?: string): boolean {
    if (this.ctx.hasRol('admin')) return true;
    return modulo ? this.ctx.hasModulo(modulo) : true;
  }

  guiasVisibles = computed(() => this.guias().filter((g) => this.canVerModulo(g.modulo)));

  private categoriasVisibles = computed(() =>
    this.categorias().filter((c) => {
      if (this.ctx.hasRol('admin')) return true;
      if (c.soloAdmin) return false;
      return c.modulo ? this.ctx.hasModulo(c.modulo) : true;
    }),
  );

  categoriasFiltradas = computed<DudaCategoria[]>(() => {
    const q = this.dudasQuery().toLowerCase().trim();
    const base = this.categoriasVisibles();
    if (!q) return base;
    return base
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => i.pregunta.toLowerCase().includes(q) || i.respuesta.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
  });

  hayDudas = computed(() => this.guiasVisibles().length > 0 || this.categoriasFiltradas().length > 0);

  // ── CM3 (F5) — "Aprende viendo" + videos de instalación ──────────────────────
  // Chip de módulo activo para la rejilla de videos ('Todos' = sin filtro).
  videoChip = signal<string>('Todos');

  /** Videos de GUÍAS visibles por rol (NO los de instalación). */
  videosGuia = computed(() =>
    this.guiasVisibles().filter((g) => this.guiaTieneVideo(g) && !g.instalacion),
  );

  /** CM1 — los 2 videos de instalación: universales (no se gatean por módulo). */
  videosInstalacion = computed(() => this.guias().filter((g) => !!g.instalacion));

  /** Chips de módulo presentes entre los videos de guía (+ 'Todos'). */
  chipsVideo = computed<string[]>(() => {
    const mods = new Set<string>();
    for (const g of this.videosGuia()) if (g.modulo) mods.add(g.modulo);
    return ['Todos', ...[...mods].sort()];
  });

  /** Rejilla de "Aprende viendo" filtrada por el chip activo. */
  videosFiltrados = computed(() => {
    const chip = this.videoChip();
    const base = this.videosGuia();
    return chip === 'Todos' ? base : base.filter((g) => g.modulo === chip);
  });

  hayVideos = computed(() => this.videosInstalacion().length > 0 || this.videosGuia().length > 0);

  private readonly moduloLabels: Record<string, string> = {
    flota: 'Flota',
    inventario: 'Inventario',
    transporte: 'Transporte',
    bitacora: 'Bitácora',
    compras: 'Compras',
    proyectos: 'Proyectos',
  };
  chipLabel(chip: string): string {
    return chip === 'Todos' ? 'Todos' : this.moduloLabels[chip] ?? chip;
  }

  /**
   * CM3 — abre el reproductor a pantalla completa con el video de una guía. Solo
   * online y solo si ya quedó firmado; si no, avisa (no deja un card muerto).
   */
  abrirVideo(g: GuiaVisual): void {
    if (!this.network.online()) {
      this.toast.show('Necesitas conexión para ver el video', 'info');
      return;
    }
    const v = this.videoDe(g);
    if (!v) {
      this.toast.show('Cargando video…', 'info');
      return;
    }
    this.videoPlayer.open({
      url: v.url,
      poster: v.poster,
      subtitulos: v.subtitulos,
      titulo: v.titulo ?? g.titulo,
      kicker: v.kicker ?? g.kicker ?? null,
      capitulos: v.capitulos ?? null,
    });
  }

  /** CM1 — comparte el video de instalación por WhatsApp (u otra app). */
  async compartirInstalacion(g: GuiaVisual): Promise<void> {
    const v = this.videoDe(g);
    // Nunca compartimos el signed URL (expira 1h): preferimos el enlace público que
    // ponga el padre; si no hay, el enlace de la app con el instructivo.
    const url = g.compartir_url ?? environment.appUrl;
    const texto =
      g.instalacion === 'iphone'
        ? 'Cómo instalar la CSD App en iPhone 👇'
        : 'Cómo instalar la CSD App en Android 👇';
    try {
      await Share.share({ title: g.titulo, text: texto, url, dialogTitle: 'Compartir' });
    } catch {
      /* el usuario canceló la hoja de compartir → no pasa nada */
    }
    void v; // (firmado disponible por si en el futuro se comparte el archivo)
  }

  tab = signal<Tab>('versiones');
  loading = signal(true);
  historial = signal<VersionHistorial[]>([]);
  reportes = signal<AppErrorReportRow[]>([]);
  private reportesCargados = false;
  private expandido = signal<Set<string>>(new Set());

  /** Solo el historial de la app (plataforma móvil). */
  versionesApp = computed(() => this.historial().filter((v) => v.plataforma === 'movil'));

  hayNueva = computed(() => this.version.hayNueva());
  publicada = computed(() => this.version.info()?.version_publicada ?? null);

  private route = inject(ActivatedRoute);

  constructor() {
    void this.loadVersiones();
    void this.version.check();
    // AA6 — deep-link desde el menú principal: abrir directo en la pestaña Dudas.
    if (this.route.snapshot.queryParamMap.get('tab') === 'dudas') this.setTab('dudas');
  }

  get online(): boolean {
    return this.network.online();
  }

  setTab(t: Tab): void {
    // Z26 — un usuario sin rol de Tecnología no puede abrir "Reportes de errores".
    if (t === 'errores' && !this.esTecnologia()) return;
    this.tab.set(t);
    if (t === 'errores' && !this.reportesCargados) void this.loadReportes();
    if (t === 'dudas' && !this.dudasCargadas) void this.loadDudas();
  }

  private async loadDudas(): Promise<void> {
    this.dudasCargadas = true;
    this.loading.set(true);
    try {
      const { guias, categorias } = await this.ayuda.getContenido();
      this.guias.set(guias);
      this.categorias.set(categorias);
      void this.cargarVideos(guias);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * CK5 — Firma los videos de las guías que lo traen. SOLO online (nunca firma ni
   * streamea offline) y NO precachea: deja listo el signed URL para que el `<video>`
   * lo pida al reproducir. Best-effort por guía.
   */
  private async cargarVideos(guias: GuiaVisual[]): Promise<void> {
    if (!this.network.online()) return;
    for (const g of guias) {
      if (!this.ayuda.pathVideo(g)) continue;
      const firmado = await this.ayuda.firmarVideoGuia(g);
      this.videos.update((m) => ({ ...m, [g.id]: firmado }));
    }
  }

  /** CK5 — ¿la guía declara un video (haya o no conexión)? */
  guiaTieneVideo(g: GuiaVisual): boolean {
    return !!this.ayuda.pathVideo(g);
  }

  /** CK5 — estado del player de una guía con video declarado. */
  estadoVideo(g: GuiaVisual): 'offline' | 'cargando' | 'listo' | 'error' {
    if (!this.network.online()) return 'offline';
    const map = this.videos();
    if (!(g.id in map)) return 'cargando';
    return map[g.id] ? 'listo' : 'error';
  }

  videoDe(g: GuiaVisual): GuiaVideoFirmado | null {
    return this.videos()[g.id] ?? null;
  }

  toggleDuda(key: string): void {
    this.expandidaDuda.update((cur) => (cur === key ? null : key));
  }
  dudaAbierta(key: string): boolean {
    return this.expandidaDuda() === key;
  }

  private async loadVersiones(): Promise<void> {
    this.loading.set(true);
    try {
      this.historial.set(await this.version.historial());
    } catch {
      this.historial.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadReportes(): Promise<void> {
    this.reportesCargados = true;
    this.loading.set(true);
    try {
      this.reportes.set(await this.errores.listRecent(100));
    } finally {
      this.loading.set(false);
    }
  }

  abierto(id: string): boolean {
    return this.expandido().has(id);
  }
  toggle(id: string): void {
    this.expandido.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  dispositivo(r: AppErrorReportRow): string {
    return [r.device_brand, r.device_model].filter(Boolean).join(' ') || 'Dispositivo';
  }

  ruta(r: AppErrorReportRow): string {
    const ctx = r.context ?? {};
    return typeof ctx['route'] === 'string' ? (ctx['route'] as string) : '';
  }

  fmtFecha(iso: string | null): string {
    return iso ? formatFechaMedia(iso) : '—';
  }

  /** BP5 — abre las Dev notes (solo roles de Tecnología). */
  abrirDevNotes(): void {
    void this.router.navigate(['/tecnologia/dev-notes']);
  }

  back(): void {
    this.location.back();
  }
}
