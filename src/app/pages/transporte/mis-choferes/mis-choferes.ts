import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TrabajosService, ChoferPanel, TrabajoEvento } from '../../../core/services/trabajos.service';
import { MensajesService } from '../../../core/services/mensajes.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatFechaRelativa } from '../../../core/util/fecha';

const ESTADO_CHOFER_LABEL: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  descanso: 'En descanso',
  almuerzo: 'En almuerzo',
  inactivo: 'Inactivo',
  sin_estado: 'Sin estado',
};

const EVENTO_LABEL: Record<TrabajoEvento, string> = {
  en_camino: 'Voy en camino',
  llegue: 'Llegué',
  trabajando: 'Cargando / trabajando',
  termine: 'Terminé',
  problema: 'Tengo un problema',
};

/** CK16 — nivel de "última señal" por antigüedad. */
type SenalNivel = 'verde' | 'ambar' | 'rojo' | 'sin';

const DIEZ_MIN = 10 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;
const TREINTA_MIN = 30 * 60 * 1000;
const POLL_MS = 30_000;

/**
 * CK16 — "Mis choferes": monitor de choferes activos (gate es_flota_elevado).
 * Una tarjeta por chofer: estado + "desde hace…", trabajo de hoy (hechos/pendientes),
 * vehículo en uso, última señal con color (verde <10 min, ámbar <1 h, rojo más),
 * batería, Llamar (tel:) y Mensaje (abre el chat directo). Orden: con problema →
 * sin señal → en trabajo → disponibles → inactivos. Sondeo cada 30 s SOLO con la
 * pantalla visible (effect + visibilitychange; se limpia en ngOnDestroy — sin batería
 * de fondo). Tap → línea de tiempo del día + enlace a Seguimiento (no un mapa nuevo).
 */
@Component({
  selector: 'app-mis-choferes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, LiveRefreshDirective, TranslatePipe],
  templateUrl: './mis-choferes.html',
  styleUrl: './mis-choferes.scss',
})
export class MisChoferesPage implements OnDestroy {
  private trabajosSvc = inject(TrabajosService);
  private mensajes = inject(MensajesService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);

  fmtRel = formatFechaRelativa;

  readonly glyph = {
    header: '🧑‍✈️',
    refresh: '🔄',
    empty: '🚦',
    vehiculo: '🚗',
    bateria: '🔋',
    senal: '📶',
    llamar: '📞',
    mensaje: '💬',
    mapa: '📍',
    alerta: '⚠️',
    reloj: '⏱️',
  };

  loading = signal(true);
  refrescando = signal(false);
  choferes = signal<ChoferPanel[]>([]);
  abiertoId = signal<string>(''); // conductor_id de la tarjeta expandida
  eventos = signal<Array<{ evento: TrabajoEvento; nota: string | null; cuando: string }>>([]);
  cargandoEventos = signal(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onVisibility = (): void => this.sincronizarPoll();

  constructor() {
    void this.load();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.sincronizarPoll();
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.detenerPoll();
  }

  /** CK16 — arranca/para el sondeo según la visibilidad de la pantalla. */
  private sincronizarPoll(): void {
    if (document.visibilityState === 'visible') {
      if (!this.pollTimer) this.pollTimer = setInterval(() => void this.refrescar(true), POLL_MS);
    } else {
      this.detenerPoll();
    }
  }
  private detenerPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.choferes.set(this.ordenar(await this.trabajosSvc.misChoferes()));
    } finally {
      this.loading.set(false);
    }
  }

  async refrescar(silent = false): Promise<void> {
    if (!silent) this.refrescando.set(true);
    try {
      await this.trabajosSvc.invalidarChoferes();
      this.choferes.set(this.ordenar(await this.trabajosSvc.misChoferes()));
    } finally {
      if (!silent) this.refrescando.set(false);
    }
  }

  // ── Orden: con problema → sin señal → en trabajo → disponibles → inactivos ─────
  private rango(c: ChoferPanel): number {
    if (this.sinSenalConTrabajo(c)) return 1; // "problema" fiable no está en el panel → la alerta de señal manda
    if (this.nivelSenal(c) === 'sin') return 2;
    if (c.estado === 'en_ruta') return 3;
    if (c.estado === 'disponible') return 4;
    if (c.estado === 'inactivo') return 6;
    return 5;
  }
  private ordenar(list: ChoferPanel[]): ChoferPanel[] {
    return [...list].sort((a, b) => this.rango(a) - this.rango(b) || a.nombre.localeCompare(b.nombre));
  }

  // ── Última señal ───────────────────────────────────────────────────────────────
  nivelSenal(c: ChoferPanel): SenalNivel {
    if (!c.ultimaSenal) return 'sin';
    const edad = Date.now() - new Date(c.ultimaSenal).getTime();
    if (isNaN(edad)) return 'sin';
    if (edad < DIEZ_MIN) return 'verde';
    if (edad < UNA_HORA) return 'ambar';
    return 'rojo';
  }
  senalTexto(c: ChoferPanel): string {
    if (!c.ultimaSenal) return this.i18n.t('Sin señal');
    return this.fmtRel(c.ultimaSenal);
  }

  estadoLabel(e: string): string {
    return ESTADO_CHOFER_LABEL[e] ?? e;
  }
  eventoLabel(e: TrabajoEvento): string {
    return EVENTO_LABEL[e] ?? e;
  }

  /** CK16.4 — alerta computable del panel: trabajo asignado + sin señal >30 min. */
  sinSenalConTrabajo(c: ChoferPanel): boolean {
    if (c.trabajosHoy <= 0 && c.estado !== 'en_ruta') return false;
    if (!c.ultimaSenal) return true;
    const edad = Date.now() - new Date(c.ultimaSenal).getTime();
    return !isNaN(edad) && edad > TREINTA_MIN;
  }

  // ── Tap → línea de tiempo del día ─────────────────────────────────────────────
  async toggle(c: ChoferPanel): Promise<void> {
    const abrir = this.abiertoId() !== c.conductorId;
    this.abiertoId.set(abrir ? c.conductorId : '');
    this.eventos.set([]);
    if (!abrir || !c.usuarioId) return;
    this.cargandoEventos.set(true);
    try {
      const evs = await this.trabajosSvc.eventosChofer(c.usuarioId);
      if (this.abiertoId() === c.conductorId) this.eventos.set(evs);
    } finally {
      this.cargandoEventos.set(false);
    }
  }

  // ── Contacto ───────────────────────────────────────────────────────────────────
  llamar(tel: string | null): void {
    if (!tel) return;
    window.location.href = `tel:${tel}`;
  }

  async mensaje(c: ChoferPanel): Promise<void> {
    if (!c.usuarioId) {
      this.toast.error(this.i18n.t('Este chofer no tiene usuario para chatear.'));
      return;
    }
    try {
      const id = await this.mensajes.crearConversacionDirecta(c.usuarioId);
      void this.router.navigate(['/mensajes', id]);
    } catch (e) {
      this.toast.error((e as Error)?.message || this.i18n.t('No se pudo abrir el chat.'));
    }
  }

  /** CK16 — enlace a Seguimiento enfocando a este chofer (no un mapa nuevo). */
  verEnMapa(c: ChoferPanel): void {
    void this.router.navigate(['/transporte/seguimiento'], { queryParams: { usuario: c.usuarioId } });
  }

  back(): void {
    this.location.back();
  }
}
