import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ExportService, ExportDoc } from '../../../core/services/export.service';
import { PersonalObraService, LevantamientoHoy, LevantamientoPersona } from '../../../core/services/personal-obra.service';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/**
 * DB3 — "Levantamiento de hoy": quién está presente hoy en una obra, quién es
 * nuevo (registrado hoy) y quién falta respecto al último levantamiento CERRADO.
 * Es una pantalla ONLINE-only (lee+crea vía `levantamiento_de_hoy`; no hay
 * contrato de caché de "solo hoy" en este app, a diferencia de CatalogService que
 * cachea catálogos estables) — sin señal se muestra un aviso claro, sin reintentos
 * silenciosos que confundan el estado del día.
 */
@Component({
  selector: 'app-personal-levantamiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, CollapsibleSelect, ConfirmDialog, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './personal-levantamiento.html',
  styleUrl: './personal-levantamiento.scss',
})
export class PersonalLevantamientoPage {
  private service = inject(PersonalObraService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private exportSvc = inject(ExportService);

  readonly online = this.network.online;

  /** CP1/AW12 — glifos desde TS (guarda no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyphLevantamiento = '📋';
  readonly glyphRefresh = '🔄';
  readonly glyphOffline = '📡';
  readonly glyphObra = '🏗';
  readonly glyphCerrado = '🔒';
  readonly glyphPersonal = '🧑‍🔧';
  readonly glyphExcel = '📊';

  loading = signal(true);
  error = signal('');
  obras = signal<{ id: string; nombre: string }[]>([]);
  proyectoId = signal('');
  data = signal<LevantamientoHoy | null>(null);
  cerrando = signal(false);
  confirmCerrar = signal(false);
  /** Fila en vuelo (id → true) para deshabilitar el toggle mientras marca. */
  marcando = signal<Record<string, boolean>>({});

  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  obraNombre = computed(() => this.obras().find((o) => o.id === this.proyectoId())?.nombre ?? '');

  personal = computed(() => this.data()?.personal ?? []);
  presentes = computed(() => this.personal().filter((p) => p.presente === true).length);
  nuevosHoy = computed(() => this.personal().filter((p) => p.nuevo_hoy).length);
  faltan = computed(() => this.personal().filter((p) => p.en_ultimo && p.presente !== true).length);
  cerrado = computed(() => !!this.data()?.cerrado_at);

  constructor() {
    const preObra = this.route.snapshot.queryParamMap.get('obra') ?? this.ctx.obraActiva()?.id ?? '';
    void this.init(preObra);
  }

  private async init(preObra: string): Promise<void> {
    this.loading.set(true);
    try {
      const obras = await this.service.getObras().catch(() => [] as { id: string; nombre: string }[]);
      this.obras.set(obras);
      if (preObra && obras.some((o) => o.id === preObra)) {
        this.proyectoId.set(preObra);
        await this.cargar();
      }
    } finally {
      this.loading.set(false);
    }
  }

  seleccionarObra(id: string): void {
    this.proyectoId.set(id);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    if (!this.proyectoId()) return;
    if (!this.network.online()) {
      this.error.set(this.i18n.t('Necesitas conexión para ver el levantamiento de hoy.'));
      this.data.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const d = await this.service.levantamientoDeHoy(this.proyectoId());
      this.data.set(d);
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo cargar el levantamiento de hoy.'));
    } finally {
      this.loading.set(false);
    }
  }

  refrescar(): void {
    void this.cargar();
  }

  /** Toggle optimista: marca al instante y revierte si el servidor rechaza (p. ej. 22023 cerrado). */
  async marcar(p: LevantamientoPersona, presente: boolean): Promise<void> {
    if (this.cerrado() || this.marcando()[p.personal_id]) return;
    if (p.presente === presente) return;
    const prev = p.presente;
    this.actualizarFila(p.personal_id, presente);
    this.marcando.update((m) => ({ ...m, [p.personal_id]: true }));
    try {
      await this.service.levantamientoMarcar(p.personal_id, presente);
    } catch (e) {
      this.actualizarFila(p.personal_id, prev);
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo marcar. Intenta de nuevo.'));
    } finally {
      this.marcando.update((m) => {
        const next = { ...m };
        delete next[p.personal_id];
        return next;
      });
    }
  }

  private actualizarFila(personalId: string, presente: boolean | null): void {
    this.data.update((d) =>
      d ? { ...d, personal: d.personal.map((x) => (x.personal_id === personalId ? { ...x, presente } : x)) } : d,
    );
  }

  pedirCerrar(): void {
    if (!this.data() || this.cerrado()) return;
    this.confirmCerrar.set(true);
  }
  cancelarCerrar(): void {
    this.confirmCerrar.set(false);
  }

  async confirmarCerrar(): Promise<void> {
    this.confirmCerrar.set(false);
    const d = this.data();
    if (!d || this.cerrando()) return;
    this.cerrando.set(true);
    try {
      await this.service.levantamientoCerrar(d.id);
      this.data.update((cur) => (cur ? { ...cur, cerrado_at: new Date().toISOString() } : cur));
      this.toast.success(this.i18n.t('Levantamiento de hoy cerrado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cerrar el levantamiento.'));
    } finally {
      this.cerrando.set(false);
    }
  }

  /** Descarga/comparte el levantamiento de hoy como Excel (una hoja: ExportTable solo soporta una). */
  descargarExcel(): void {
    const d = this.data();
    if (!d) return;
    const estado = (p: LevantamientoPersona) => (p.presente === true ? this.i18n.t('Presente') : p.presente === false ? this.i18n.t('Ausente') : this.i18n.t('Sin marcar'));
    const rows = this.personal().map((p) => [
      p.nombre,
      p.apellido,
      p.cargo ?? '',
      p.documento_numero ?? '',
      estado(p),
      p.nuevo_hoy ? this.i18n.t('Sí') : this.i18n.t('No'),
      p.en_ultimo ? this.i18n.t('Sí') : this.i18n.t('No'),
    ]);
    const doc: ExportDoc = {
      title: this.i18n.t('Levantamiento de hoy'),
      filenameBase: 'levantamiento',
      meta: [
        { label: this.i18n.t('Obra'), value: this.obraNombre() },
        { label: this.i18n.t('Fecha'), value: d.fecha },
        { label: this.i18n.t('Presentes'), value: String(this.presentes()) },
        { label: this.i18n.t('Nuevos hoy'), value: String(this.nuevosHoy()) },
        { label: this.i18n.t('Faltan'), value: String(this.faltan()) },
      ],
      table: {
        columns: [
          this.i18n.t('Nombre'),
          this.i18n.t('Apellido'),
          this.i18n.t('Cargo'),
          this.i18n.t('Documento'),
          this.i18n.t('Estado'),
          this.i18n.t('Nuevo hoy'),
          this.i18n.t('Estaba el último día'),
        ],
        rows,
      },
      footer: this.cerrado() ? this.i18n.t('Levantamiento cerrado.') : this.i18n.t('Levantamiento abierto (puede seguir cambiando).'),
    };
    void this.exportSvc.share(doc, 'excel');
  }

  abrirPersonal(p: LevantamientoPersona): void {
    void this.router.navigate(['/proyectos/personal', p.personal_id]);
  }

  back(): void {
    this.location.back();
  }
}
