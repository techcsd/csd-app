import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { GenerarAcceso } from '../../../shared/components/generar-acceso/generar-acceso';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { ChecklistBreakdown, FlotaAccidente, FlotaEntrega, FlotaMulta } from '../../../core/models/flota-reportes.model';
import { UserContextService } from '../../../core/services/user-context.service';
import { SyncService } from '../../../core/sync/sync.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedDoc } from '../../../core/services/camera.service';
import { Conductor, ConductorStats, LicenciaEstado, estadoLicencia, diasHasta } from '../../../core/models/conductor.model';
import { Documento } from '../../../core/models/documento.model';
import { formatFecha, formatFechaMedia } from '../../../core/util/fecha';

interface DocView {
  label: string;
  url: string | null;
  esPdf: boolean;
}

const TIPO_LABEL: Record<string, string> = {
  cedula: 'Cédula',
  licencia: 'Licencia de conducir',
  otro: 'Otro documento',
};

/**
 * Driver profile for browsing ANY conductor (R5): stats + documents (view via
 * signed URLs). P3 — desde aquí también se pueden SUBIR/REEMPLAZAR los
 * documentos (cédula/licencia) desde el teléfono, encolados por outbox, con
 * badge "Subiendo…" mientras sincronizan. Gated a admin/flota o el propio
 * conductor (mismo criterio que la web).
 */
@Component({
  selector: 'app-perfil-conductor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DocSlot, GenerarAcceso],
  templateUrl: './perfil-conductor.html',
  styleUrl: './perfil-conductor.scss',
})
export class PerfilConductorPage {
  private route = inject(ActivatedRoute);
  private conductores = inject(ConductoresService);
  private documentos = inject(DocumentosService);
  private flotaReportes = inject(FlotaReportesService);
  private ctx = inject(UserContextService);
  private sync = inject(SyncService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  fmtFecha = formatFecha;
  fmtFechaMedia = formatFechaMedia;

  loading = signal(true);
  condId = signal('');
  stats = signal<ConductorStats | null>(null);
  conductor = signal<Conductor | null>(null); // C3 — nota/tags
  // C5 — TODAS las fotos por tipo (licencia: frente y dorso), no solo la última.
  cedulas = signal<DocView[]>([]);
  licencias = signal<DocView[]>([]);
  otros = signal<DocView[]>([]);
  esMiPerfil = signal(false);
  esAdmin = () => this.ctx.hasModulo('admin');
  // S32 — actividad: accidentes, multas, entregas y desglose de checklists.
  multas = signal<FlotaMulta[]>([]);
  accidentes = signal<FlotaAccidente[]>([]);
  entregas = signal<FlotaEntrega[]>([]);
  breakdown = signal<ChecklistBreakdown>({ preuso: 0, semanal: 0 });

  // P3 — permiso para subir/reemplazar documentos: admin, flota, o el propio
  // conductor (mismo criterio que la web). La ruta ya está gated a flota.
  puedeEditar = computed(() => this.esAdmin() || this.ctx.hasModulo('flota') || this.esMiPerfil());
  // P3 — tipos de documento encolados (pendientes de sincronizar) para el badge.
  private enColaTipos = signal<string[]>([]);
  cedulaEnCola = computed(() => this.enColaTipos().includes('cedula'));
  licenciaEnCola = computed(() => this.enColaTipos().includes('licencia'));
  subiendo = signal(false);

  // P8 — generar/restablecer el PIN de acceso (admin/flota). El route ya está
  // gated a flota, así que quien llega puede gestionarlo.
  puedeGestionarAcceso = computed(() => this.esAdmin() || this.ctx.hasModulo('flota'));
  mostrarAcceso = signal(false);

  // C6 — badge de licencia (mismo umbral configurable que la web/listado).
  umbral = signal(90);
  licEstado = computed<LicenciaEstado>(() =>
    estadoLicencia(this.conductor()?.licencia_vencimiento ?? null, this.umbral()),
  );
  licDias = computed(() => diasHasta(this.conductor()?.licencia_vencimiento ?? null));

  constructor() {
    void this.load();
    // P3 — al drenar el outbox (o cualquier cambio), refrescar docs + cola: el
    // "Subiendo…" desaparece y aparece el documento ya cargado del servidor.
    effect(() => {
      this.sync.changed();
      const id = this.condId();
      if (id) {
        void this.loadEnCola(id);
        void this.loadDocs(id);
      }
    });
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('conductorId') ?? '';
    this.condId.set(id);
    this.loading.set(true);
    try {
      this.stats.set(await this.conductores.getStatsDe(id));
      try {
        this.conductor.set(await this.conductores.getConductor(id));
      } catch {
        /* nota/tags son secundarios: el perfil se ve igual sin ellos */
      }
      try {
        const cfg = await this.conductores.getFlotaConfig();
        this.umbral.set(cfg.licenciaDias);
      } catch {
        /* umbral por defecto (90) si no hay config cacheada */
      }
      const mio = await this.conductores.getMiConductor();
      this.esMiPerfil.set(!!mio && mio.id === id);
      await this.loadDocs(id);
      await this.loadEnCola(id);
      // S32 — accidentes + multas + entregas + desglose (best-effort, online).
      void this.flotaReportes.getMultasConductor(id).then((m) => this.multas.set(m));
      void this.flotaReportes.getAccidentesConductor(id).then((a) => this.accidentes.set(a));
      void this.flotaReportes.getChecklistsBreakdown(id).then((b) => this.breakdown.set(b));
      const uid = this.conductor()?.usuario_id;
      if (uid) void this.flotaReportes.getEntregasConductor(uid).then((e) => this.entregas.set(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEnCola(id: string): Promise<void> {
    if (!id) return;
    try {
      this.enColaTipos.set(await this.documentos.tiposEnCola('conductor', id));
    } catch {
      /* la cola es secundaria; el perfil se ve igual sin ella */
    }
  }

  /** P3 — sube/reemplaza un documento desde el perfil (encolado por outbox). */
  async onDoc(tipo: 'cedula' | 'licencia', doc: CapturedDoc): Promise<void> {
    if (this.subiendo()) return;
    this.subiendo.set(true);
    try {
      await this.documentos.enqueueDocumento({ entidad: 'conductor', entidadId: this.condId(), tipo, doc });
      await this.loadEnCola(this.condId());
      this.toast.success('Documento en cola. Se subirá cuando haya conexión.');
    } catch {
      this.toast.error('No se pudo poner el documento en cola. Intenta de nuevo.');
    } finally {
      this.subiendo.set(false);
    }
  }

  private async loadDocs(id: string): Promise<void> {
    if (!id) return;
    const docs = await this.documentos.getDocumentos('conductor', id); // ordenado desc
    const toView = async (d: Documento, label: string): Promise<DocView> => ({
      label,
      url: await this.documentos.getSignedUrl(d.path),
      esPdf: /\.pdf$/i.test(d.path),
    });
    // C5 — todas las fotos por tipo, numeradas cuando hay más de una.
    const porTipo = (tipo: string, base: string): Promise<DocView[]> => {
      const list = docs.filter((d) => d.tipo === tipo);
      return Promise.all(list.map((d, i) => toView(d, list.length > 1 ? `${base} (${i + 1})` : base)));
    };
    this.cedulas.set(await porTipo('cedula', 'Cédula'));
    this.licencias.set(await porTipo('licencia', 'Licencia de conducir'));
    const otros = docs.filter((d) => d.tipo !== 'cedula' && d.tipo !== 'licencia');
    this.otros.set(await Promise.all(otros.map((d) => toView(d, TIPO_LABEL[d.tipo] ?? d.nombre ?? d.tipo))));
  }

  abrirAcceso(): void {
    this.mostrarAcceso.set(true);
  }
  cerrarAcceso(): void {
    this.mostrarAcceso.set(false);
  }
  onAccesoGenerado(res: { usuarioId: string }): void {
    // Reflejar el enlace usuario_id sin recargar todo.
    const c = this.conductor();
    if (c && res.usuarioId) this.conductor.set({ ...c, usuario_id: res.usuarioId });
  }

  irMiActividad(): void {
    void this.router.navigate(['/transporte/mi-actividad']);
  }

  editar(): void {
    void this.router.navigate(['/transporte/conductores', this.condId(), 'editar']);
  }

  /** S24 — registrarle una multa a este conductor (roles elevados). */
  multar(): void {
    void this.router.navigate(['/transporte/conductor', this.condId(), 'multa']);
  }
  /** W5 — abrir el detalle de una multa del conductor. */
  verMulta(id: string): void {
    void this.router.navigate(['/transporte/mi-registro', 'multa', id]);
  }

  back(): void {
    this.location.back();
  }
}
