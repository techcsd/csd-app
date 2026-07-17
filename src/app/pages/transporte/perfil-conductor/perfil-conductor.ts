import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { UserContextService } from '../../../core/services/user-context.service';
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
 * Read-only driver profile for browsing ANY conductor (R5): stats + documents
 * (view via signed URLs). Uploading/replacing is done by the driver from "Mi
 * actividad" (own profile); here documents are view-only.
 */
@Component({
  selector: 'app-perfil-conductor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DocSlot],
  templateUrl: './perfil-conductor.html',
  styleUrl: './perfil-conductor.scss',
})
export class PerfilConductorPage {
  private route = inject(ActivatedRoute);
  private conductores = inject(ConductoresService);
  private documentos = inject(DocumentosService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  fmtFecha = formatFecha;
  fmtFechaMedia = formatFechaMedia;

  loading = signal(true);
  private condId = signal('');
  stats = signal<ConductorStats | null>(null);
  conductor = signal<Conductor | null>(null); // C3 — nota/tags
  // C5 — TODAS las fotos por tipo (licencia: frente y dorso), no solo la última.
  cedulas = signal<DocView[]>([]);
  licencias = signal<DocView[]>([]);
  otros = signal<DocView[]>([]);
  esMiPerfil = signal(false);
  esAdmin = () => this.ctx.hasModulo('admin');

  // C6 — badge de licencia (mismo umbral configurable que la web/listado).
  umbral = signal(90);
  licEstado = computed<LicenciaEstado>(() =>
    estadoLicencia(this.conductor()?.licencia_vencimiento ?? null, this.umbral()),
  );
  licDias = computed(() => diasHasta(this.conductor()?.licencia_vencimiento ?? null));

  constructor() {
    void this.load();
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
    } finally {
      this.loading.set(false);
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

  irMiActividad(): void {
    void this.router.navigate(['/transporte/mi-actividad']);
  }

  editar(): void {
    void this.router.navigate(['/transporte/conductores', this.condId(), 'editar']);
  }

  back(): void {
    this.location.back();
  }
}
