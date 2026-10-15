import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { LegalService } from '../../../core/services/legal.service';
import { SolicitudesCompraService } from '../../../core/services/solicitudes-compra.service';
import {
  ExpedienteArchivo,
  ExpedienteEstado,
  ExpedienteLegal,
  ExpedienteNota,
  ExpedientePrioridad,
  ExpedienteTipo,
} from '../../../core/models/legal.model';
import { Proyecto } from '../../../core/models/bitacora.model';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFechaMedia, formatFechaCortaHora } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const TIPO_LABEL: Record<ExpedienteTipo, string> = {
  laboral: 'Laboral',
  permiso: 'Permiso',
  reclamacion: 'Reclamación',
  litigio: 'Litigio',
  cumplimiento: 'Cumplimiento',
  contractual: 'Contractual',
  otro: 'Otro',
};
const ESTADO_LABEL: Record<ExpedienteEstado, string> = {
  abierto: 'Abierto',
  en_proceso: 'En proceso',
  en_espera: 'En espera',
  cerrado: 'Cerrado',
};
const PRIORIDAD_LABEL: Record<ExpedientePrioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
};

type Tab = 'resumen' | 'notas' | 'archivos';

/**
 * CO11/CO13 — Expedientes legales: lista + KPIs + ficha con pestañas
 * (Resumen/Notas/Archivos). Solo en línea (sin RPC ni outbox del padre). Sin
 * acceso a Contratos vinculados en esta primera pasada (ver `contratos.ts`
 * para la relación inversa documento↔contrato).
 */
@Component({
  selector: 'app-expedientes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, CollapsibleSelect, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './expedientes.html',
  styleUrl: './expedientes.scss',
})
export class ExpedientesPage {
  private legal = inject(LegalService);
  private solicitudesCompra = inject(SolicitudesCompraService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  tipoLabel = (t: ExpedienteTipo): string => TIPO_LABEL[t] ?? t;
  estadoLabel = (e: ExpedienteEstado): string => ESTADO_LABEL[e] ?? e;
  prioridadLabel = (p: ExpedientePrioridad): string => PRIORIDAD_LABEL[p] ?? p;
  fmtFecha = formatFechaMedia;
  fmtFechaHora = formatFechaCortaHora;

  loading = signal(true);
  error = signal(false);
  lista = signal<ExpedienteLegal[]>([]);

  kpis = computed(() => {
    const l = this.lista();
    return {
      abiertos: l.filter((e) => e.estado !== 'cerrado').length,
      vencenPronto: l.filter((e) => {
        if (!e.fecha_limite || e.estado === 'cerrado') return false;
        const dias = (new Date(e.fecha_limite).getTime() - Date.now()) / 86400000;
        return dias >= 0 && dias <= 15;
      }).length,
      montoReclamado: l.reduce((acc, e) => acc + (e.monto_reclamado ?? 0), 0),
      cerrados: l.filter((e) => e.estado === 'cerrado').length,
    };
  });

  // ── Ficha ───────────────────────────────────────────────────────────────
  abierto = signal<ExpedienteLegal | null>(null);
  tab = signal<Tab>('resumen');
  notas = signal<ExpedienteNota[]>([]);
  archivos = signal<ExpedienteArchivo[]>([]);
  cargandoTab = signal(false);
  nuevaNota = signal('');
  guardandoNota = signal(false);
  subiendoArchivo = signal(false);
  cambiandoEstado = signal(false);

  // ── Crear ───────────────────────────────────────────────────────────────
  creando = signal(false);
  guardandoNuevo = signal(false);
  proyectos = signal<Proyecto[]>([]);
  proyectoOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));
  nTitulo = signal('');
  nTipo = signal<ExpedienteTipo>('laboral');
  nPrioridad = signal<ExpedientePrioridad>('media');
  nProyectoId = signal('');
  nContraparte = signal('');
  nDescripcion = signal('');
  readonly tipos: ExpedienteTipo[] = ['laboral', 'permiso', 'reclamacion', 'litigio', 'cumplimiento', 'contractual', 'otro'];
  readonly prioridades: ExpedientePrioridad[] = ['baja', 'media', 'alta', 'urgente'];
  readonly estados: ExpedienteEstado[] = ['abierto', 'en_proceso', 'en_espera', 'cerrado'];

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.lista.set(await this.legal.listarExpedientes());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async abrir(e: ExpedienteLegal): Promise<void> {
    this.abierto.set(e);
    this.tab.set('resumen');
    this.notas.set([]);
    this.archivos.set([]);
  }

  cerrarFicha(): void {
    this.abierto.set(null);
  }

  async cambiarTab(t: Tab): Promise<void> {
    this.tab.set(t);
    const exp = this.abierto();
    if (!exp) return;
    if (t === 'notas' && !this.notas().length) {
      this.cargandoTab.set(true);
      try {
        this.notas.set(await this.legal.notas(exp.id));
      } catch {
        /* best-effort */
      } finally {
        this.cargandoTab.set(false);
      }
    }
    if (t === 'archivos' && !this.archivos().length) {
      this.cargandoTab.set(true);
      try {
        this.archivos.set(await this.legal.archivos(exp.id));
      } catch {
        /* best-effort */
      } finally {
        this.cargandoTab.set(false);
      }
    }
  }

  async guardarNota(): Promise<void> {
    const exp = this.abierto();
    const texto = this.nuevaNota().trim();
    if (!exp || !texto || this.guardandoNota()) return;
    this.guardandoNota.set(true);
    try {
      await this.legal.agregarNota(exp.id, texto);
      this.nuevaNota.set('');
      this.notas.set(await this.legal.notas(exp.id));
      this.toast.success(this.i18n.t('Nota guardada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la nota.'));
    } finally {
      this.guardandoNota.set(false);
    }
  }

  async cambiarEstado(estado: ExpedienteEstado): Promise<void> {
    const exp = this.abierto();
    if (!exp || this.cambiandoEstado()) return;
    this.cambiandoEstado.set(true);
    try {
      await this.legal.cambiarEstadoExpediente(exp.id, estado);
      this.abierto.update((e) => (e ? { ...e, estado } : e));
      this.lista.update((l) => l.map((e) => (e.id === exp.id ? { ...e, estado } : e)));
      this.toast.success(this.i18n.t('Estado actualizado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cambiar el estado.'));
    } finally {
      this.cambiandoEstado.set(false);
    }
  }

  async onArchivoElegido(ev: Event): Promise<void> {
    const exp = this.abierto();
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!exp || !file || this.subiendoArchivo()) return;
    this.subiendoArchivo.set(true);
    try {
      await this.legal.subirArchivo(exp.id, file, file.name, file.type || 'application/octet-stream');
      this.archivos.set(await this.legal.archivos(exp.id));
      this.toast.success(this.i18n.t('Archivo adjuntado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo adjuntar el archivo.'));
    } finally {
      this.subiendoArchivo.set(false);
    }
  }

  // ── Crear expediente ─────────────────────────────────────────────────────
  async abrirCrear(): Promise<void> {
    this.creando.set(true);
    this.nTitulo.set('');
    this.nTipo.set('laboral');
    this.nPrioridad.set('media');
    this.nProyectoId.set('');
    this.nContraparte.set('');
    this.nDescripcion.set('');
    if (!this.proyectos().length) {
      try {
        this.proyectos.set(await this.solicitudesCompra.getProyectos());
      } catch {
        /* best-effort */
      }
    }
  }
  cerrarCrear(): void {
    this.creando.set(false);
  }

  async guardarNuevo(): Promise<void> {
    const titulo = this.nTitulo().trim();
    if (!titulo) {
      this.toast.error(this.i18n.t('Escribe el título del expediente.'));
      return;
    }
    if (this.guardandoNuevo()) return;
    this.guardandoNuevo.set(true);
    try {
      await this.legal.crearExpediente({
        titulo,
        tipo: this.nTipo(),
        prioridad: this.nPrioridad(),
        proyectoId: this.nProyectoId() || null,
        contraparte: this.nContraparte().trim() || null,
        descripcion: this.nDescripcion().trim() || null,
      });
      this.toast.success(this.i18n.t('Expediente creado.'));
      this.creando.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo crear el expediente.'));
    } finally {
      this.guardandoNuevo.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/legal');
  }
}
