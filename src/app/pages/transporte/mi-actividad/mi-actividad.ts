import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
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
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  stats = signal<ConductorStats | null>(null);
  esConductor = signal(true);
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
      }
    } finally {
      this.loading.set(false);
    }
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

  back(): void {
    this.location.back();
  }
}
