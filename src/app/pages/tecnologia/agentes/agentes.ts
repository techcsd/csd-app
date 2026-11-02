import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { EstadoChip } from '../../../shared/ui/estado-chip/estado-chip';
import { MarkdownView } from '../../../shared/ui/markdown-view/markdown-view';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { AgentesService } from '../../../core/services/agentes.service';
import { TecTono } from '../../../shared/utils/tec-tono.util';
import {
  Agente,
  AgenteAccion,
  AgenteAprobacion,
  AgenteEvento,
  AgenteEventoEstado,
  AgenteHallazgo,
  AgenteInformeDiario,
} from '../../../core/models/agentes.model';
import { MOTION_DIRECTIVES } from '../../../shared/motion';
import { formatFechaRelativa } from '../../../core/util/fecha';

function tonoDeEstado(estado: AgenteEventoEstado | null): TecTono {
  switch (estado) {
    case 'esperando_ok':
      return 'warning';
    case 'error':
      return 'danger';
    case 'trabajando':
      return 'info';
    case 'observando':
    case 'inactivo':
    default:
      return 'neutral';
  }
}

function tonoDeSeveridad(sev: AgenteHallazgo['severidad']): TecTono {
  switch (sev) {
    case 'critica':
      return 'danger';
    case 'alta':
      return 'warning';
    case 'media':
      return 'info';
    default:
      return 'neutral';
  }
}

const ESTADO_LABEL: Record<AgenteEventoEstado, string> = {
  observando: 'Observando',
  trabajando: 'Trabajando',
  esperando_ok: 'Espera tu OK',
  error: 'Con error',
  inactivo: 'Inactivo',
};

interface AgenteFila {
  agente: Agente;
  estado: AgenteEventoEstado | null;
  estadoLabel: string;
  tono: TecTono;
  ultimoResumen: string | null;
  ultimoCuando: string | null;
}

/**
 * DF2/DF3 (PROMPT 129) — "Tecnología › Agentes", miniatura de solo lectura (la
 * oficina isométrica completa vive solo en la web — DF5). Gate real = RLS
 * (`sgc.is_admin() or sgc.es_tecnologia()`), esta pantalla solo decide si se
 * muestra (mismo patrón CO8 que el resto de la consola de Tecnología).
 */
@Component({
  selector: 'app-agentes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, EstadoChip, MarkdownView, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './agentes.html',
  styleUrl: './agentes.scss',
})
export class AgentesPage implements OnDestroy {
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private service = inject(AgentesService);

  esTecnologia = this.ctx.esTecnologia;

  loading = signal(true);
  agentes = signal<Agente[]>([]);
  eventos = signal<AgenteEvento[]>([]);
  hallazgos = signal<AgenteHallazgo[]>([]);
  acciones = signal<AgenteAccion[]>([]);
  aprobaciones = signal<AgenteAprobacion[]>([]);
  informe = signal<AgenteInformeDiario | null>(null);
  costo = signal<{ costo_hoy: number; tope_diario: number } | null>(null);

  expandidas = signal<Set<string>>(new Set());
  decidiendo = signal<string | null>(null);
  notaAjuste = signal<Record<string, string>>({});
  mostrarInforme = signal(false);
  deshaciendo = signal<string | null>(null);

  private unsuscribir: (() => void) | null = null;

  filas = computed<AgenteFila[]>(() => {
    const porAgente = new Map<string, AgenteEvento>();
    for (const e of this.eventos()) {
      if (!porAgente.has(e.agente_id)) porAgente.set(e.agente_id, e); // ya viene ordenado desc
    }
    return this.agentes().map((agente) => {
      const u = porAgente.get(agente.id) ?? null;
      return {
        agente,
        estado: u?.estado ?? null,
        estadoLabel: this.i18n.t(u ? ESTADO_LABEL[u.estado] : 'Sin eventos aún'),
        tono: tonoDeEstado(u?.estado ?? null),
        ultimoResumen: u?.resumen ?? null,
        ultimoCuando: u?.creado_en ?? null,
      };
    });
  });

  acciones7dias = computed(() => this.acciones().filter((a) => !a.deshecha_en));

  get online(): boolean {
    return this.network.online();
  }

  constructor() {
    // DF2/DF3 — mismo gate que el resto de la consola de Tecnología (CO8): la RLS
    // real de las tablas agente_* es `is_admin() or es_tecnologia()`.
    if (!this.ctx.esTecnologia()) {
      void this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }
    void this.load();
    this.unsuscribir = this.service.suscribirEventos(() => void this.cargarEventos());
  }

  ngOnDestroy(): void {
    this.unsuscribir?.();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [agentes] = await Promise.all([this.service.listarAgentes()]);
      this.agentes.set(agentes);
      await Promise.all([
        this.cargarEventos(),
        this.cargarHallazgos(),
        this.cargarAcciones(),
        this.cargarAprobaciones(),
        this.cargarInforme(),
        this.cargarCosto(),
      ]);
    } catch {
      this.toast.error(this.i18n.t('No se pudieron cargar los agentes.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async cargarEventos(): Promise<void> {
    try {
      this.eventos.set(await this.service.ultimosEventos());
    } catch {
      /* best-effort — el punto de estado se queda "sin eventos" */
    }
  }

  private async cargarHallazgos(): Promise<void> {
    try {
      this.hallazgos.set(await this.service.hallazgosAbiertos());
    } catch {
      /* best-effort */
    }
  }

  private async cargarAcciones(): Promise<void> {
    try {
      this.acciones.set(await this.service.accionesRecientes());
    } catch {
      /* best-effort */
    }
  }

  private async cargarAprobaciones(): Promise<void> {
    try {
      this.aprobaciones.set(await this.service.aprobacionesPendientes());
    } catch {
      /* best-effort */
    }
  }

  private async cargarInforme(): Promise<void> {
    try {
      this.informe.set(await this.service.informeDeHoy());
    } catch {
      /* best-effort */
    }
  }

  private async cargarCosto(): Promise<void> {
    try {
      this.costo.set(await this.service.costoHoyTotal());
    } catch {
      /* best-effort */
    }
  }

  toggleAprobacion(id: string): void {
    this.expandidas.update((s) => {
      const copia = new Set(s);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }
  abierta(id: string): boolean {
    return this.expandidas().has(id);
  }

  setNotaAjuste(id: string, texto: string): void {
    this.notaAjuste.update((m) => ({ ...m, [id]: texto }));
  }

  /** "Aprobar para dev" NUNCA mezcla a main — solo marca el estado (regla 18, el merge real lo hace Xaviel en GitHub). */
  async aprobar(a: AgenteAprobacion): Promise<void> {
    await this.decidir(a, 'aprobada');
  }
  async pedirAjuste(a: AgenteAprobacion): Promise<void> {
    await this.decidir(a, 'ajuste', this.notaAjuste()[a.id]?.trim() || undefined);
  }
  async descartar(a: AgenteAprobacion): Promise<void> {
    await this.decidir(a, 'descartada');
  }

  private async decidir(a: AgenteAprobacion, decision: 'aprobada' | 'ajuste' | 'descartada', nota?: string): Promise<void> {
    this.decidiendo.set(a.id);
    try {
      await this.service.decidirAprobacion(a.id, decision, nota);
      this.aprobaciones.update((list) => list.filter((x) => x.id !== a.id));
      const msg: Record<typeof decision, string> = {
        aprobada: 'Aprobado para dev — el merge a main lo decides tú en GitHub.',
        ajuste: 'Le pedimos un ajuste al agente.',
        descartada: 'Propuesta descartada.',
      };
      this.toast.success(this.i18n.t(msg[decision]));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo registrar tu decisión. Inténtalo de nuevo.'));
    } finally {
      this.decidiendo.set(null);
    }
  }

  /** Deshacer una acción Nivel 2: si fue una notificación, el mensaje ya avisa que no se retira sola. */
  async deshacer(accion: AgenteAccion): Promise<void> {
    this.deshaciendo.set(accion.id);
    try {
      await this.service.deshacerAccion(accion.id);
      this.acciones.update((list) => list.map((a) => (a.id === accion.id ? { ...a, deshecha_en: new Date().toISOString() } : a)));
      this.toast.success(this.i18n.t('Deshecho.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo deshacer. Inténtalo de nuevo.'));
    } finally {
      this.deshaciendo.set(null);
    }
  }

  relativo(iso: string | null): string {
    return formatFechaRelativa(iso);
  }

  /** `pruebas_resultado` es jsonb de forma libre (lo que el Escriba reportó) — se muestra clave:valor. */
  entradasPruebas(a: AgenteAprobacion): [string, unknown][] {
    return a.pruebas_resultado ? Object.entries(a.pruebas_resultado) : [];
  }

  tonoSeveridad(sev: AgenteHallazgo['severidad']): TecTono {
    return tonoDeSeveridad(sev);
  }

  back(): void {
    this.location.back();
  }
}
