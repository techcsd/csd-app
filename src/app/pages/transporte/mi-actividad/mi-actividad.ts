import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { ConducesService } from '../../../core/services/conduces.service';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  ChecklistBreakdown,
  FlotaAccidente,
  FlotaEntrega,
  FlotaMulta,
  HistorialChecklist,
  HistorialEchada,
  RutaCreada,
} from '../../../core/models/flota-reportes.model';
import { RutaHoy } from '../../../core/models/transporte.model';
import { ConductorStats } from '../../../core/models/conductor.model';
import { Documento } from '../../../core/models/documento.model';
import { CapturedDoc } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha, formatFechaMedia } from '../../../core/util/fecha';

/** Read-only driver profile: my flota activity/telemetry (R5) + docs (X1). */
@Component({
  selector: 'app-mi-actividad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DocSlot],
  templateUrl: './mi-actividad.html',
  styleUrl: './mi-actividad.scss',
})
export class MiActividadPage {
  private conductores = inject(ConductoresService);
  private documentos = inject(DocumentosService);
  private conduces = inject(ConducesService);
  private flotaReportes = inject(FlotaReportesService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  stats = signal<ConductorStats | null>(null);
  esConductor = signal(true);
  readonly esElevado = this.ctx.esFlotaElevado; // V3 — rutas creadas
  // S32 — actividad consolidada del chofer.
  rutas = signal<RutaHoy[]>([]);
  accidentes = signal<FlotaAccidente[]>([]);
  multas = signal<FlotaMulta[]>([]);
  entregas = signal<FlotaEntrega[]>([]);
  breakdown = signal<ChecklistBreakdown>({ preuso: 0, semanal: 0 });
  // V2 — historiales navegables (no solo contadores).
  semanales = signal<HistorialChecklist[]>([]);
  preusos = signal<HistorialChecklist[]>([]);
  echadas = signal<HistorialEchada[]>([]);
  // V3 — rutas creadas por el usuario (elevados).
  rutasCreadas = signal<RutaCreada[]>([]);
  historialExpandido = signal(false); // "ver más" (90 días → todo)
  fmtFecha = formatFecha; // U9 — fecha date-only
  fmtFechaMedia = formatFechaMedia; // U9 — timestamp

  // X1 — documentos del conductor
  private condId = signal('');
  cedulaDoc = signal<Documento | null>(null);
  licenciaDoc = signal<Documento | null>(null);
  cedulaUrl = signal<string | null>(null);
  licenciaUrl = signal<string | null>(null);
  private colaTipos = signal<string[]>([]);

  cedulaEnCola = computed(() => this.colaTipos().includes('cedula'));
  licenciaEnCola = computed(() => this.colaTipos().includes('licencia'));

  /** Banner: documentos solicitados que aún faltan (ni cargados ni en cola). */
  pendientes = computed(() => {
    const p: string[] = [];
    if (!this.cedulaDoc() && !this.cedulaEnCola()) p.push('cédula');
    if (!this.licenciaDoc() && !this.licenciaEnCola()) p.push('licencia');
    return p;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const cond = await this.conductores.getMiConductor();
      this.esConductor.set(!!cond);
      if (cond) {
        this.condId.set(cond.id);
        this.stats.set(await this.conductores.getMiStats());
        await this.loadDocs();
        // S32 — rutas asignadas + accidentes + multas + entregas + desglose (best-effort, online).
        void this.conduces.misRutas().then((r) => this.rutas.set(r));
        void this.flotaReportes.getAccidentesConductor(cond.id).then((a) => this.accidentes.set(a));
        void this.flotaReportes.getMultasConductor(cond.id).then((m) => this.multas.set(m));
        void this.flotaReportes.getChecklistsBreakdown(cond.id).then((b) => this.breakdown.set(b));
        if (cond.usuario_id) void this.flotaReportes.getEntregasConductor(cond.usuario_id).then((e) => this.entregas.set(e));
        // V2 — historiales navegables del conductor.
        void this.loadHistoriales(cond.id);
      }
      // V3 — rutas que yo creé (roles elevados; independiente de ser conductor).
      if (this.esElevado()) {
        void this.flotaReportes.getMisRutasCreadas(this.dias()).then((r) => this.rutasCreadas.set(r));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** V2 — ventana del historial: 90 días o "todo" (ver más). */
  private dias(): number {
    return this.historialExpandido() ? 3650 : 90;
  }

  private async loadHistoriales(conductorId: string): Promise<void> {
    const dias = this.dias();
    const [sem, pre, ech] = await Promise.all([
      this.flotaReportes.getMisChecklists(conductorId, 'inspeccion', dias),
      this.flotaReportes.getMisChecklists(conductorId, 'pre_uso', dias),
      this.flotaReportes.getMisEchadas(conductorId, dias),
    ]);
    this.semanales.set(sem);
    this.preusos.set(pre);
    this.echadas.set(ech);
  }

  /** V2/V3 — "ver más": amplía la ventana a todo el historial y recarga. */
  async verMas(): Promise<void> {
    if (this.historialExpandido()) return;
    this.historialExpandido.set(true);
    const id = this.condId();
    if (id) await this.loadHistoriales(id);
    if (this.esElevado()) this.rutasCreadas.set(await this.flotaReportes.getMisRutasCreadas(this.dias()));
  }

  /** Etiqueta legible del veredicto de un checklist. */
  resultadoLabel(r: string | null): string {
    return r === 'bloqueado' ? '⛔ Bloqueado' : r === 'con_hallazgos' ? '⚠ Con hallazgos' : '✓ Aprobado';
  }

  private async loadDocs(): Promise<void> {
    const id = this.condId();
    if (!id) return;
    const [docs, cola] = await Promise.all([
      this.documentos.getDocumentos('conductor', id),
      this.documentos.tiposEnCola('conductor', id),
    ]);
    this.colaTipos.set(cola);
    // getDocumentos ya viene ordenado por created_at desc → el primero es el vigente.
    const ced = docs.find((d) => d.tipo === 'cedula') ?? null;
    const lic = docs.find((d) => d.tipo === 'licencia') ?? null;
    this.cedulaDoc.set(ced);
    this.licenciaDoc.set(lic);
    this.cedulaUrl.set(ced ? await this.documentos.getSignedUrl(ced.path) : null);
    this.licenciaUrl.set(lic ? await this.documentos.getSignedUrl(lic.path) : null);
  }

  async onDoc(tipo: 'cedula' | 'licencia', doc: CapturedDoc): Promise<void> {
    const id = this.condId();
    if (!id) return;
    try {
      await this.documentos.enqueueDocumento({ entidad: 'conductor', entidadId: id, tipo, doc });
      this.colaTipos.update((t) => (t.includes(tipo) ? t : [...t, tipo]));
      this.toast.success('Documento guardado. Se subirá cuando haya conexión.');
    } catch {
      this.toast.error('No se pudo guardar el documento.');
    }
  }

  esPdf(doc: Documento | null): boolean {
    return !!doc && /\.pdf$/i.test(doc.path);
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  /** S32 — drill-down a "Conduces y rutas". */
  verRutas(): void {
    void this.router.navigate(['/transporte/conduces']);
  }

  /** S24(c) — el chofer registra una multa que le pusieron (ligada a él). */
  miMulta(): void {
    const id = this.condId();
    if (id) void this.router.navigate(['/transporte/conductor', id, 'multa']);
  }

  back(): void {
    this.location.back();
  }
}
