import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { VehiculoStats } from '../../../core/models/transporte.model';
import { Documento } from '../../../core/models/documento.model';
import { CapturedDoc } from '../../../core/services/camera.service';

/** A document ready to render (label + signed URL). */
interface DocView {
  label: string;
  url: string | null;
  esPdf: boolean;
}

const TIPO_LABEL: Record<string, string> = {
  seguro: 'Seguro',
  matricula: 'Matrícula',
  otro: 'Otro documento',
};

/**
 * Vehicle profile: info + aggregated stats (R4) + documents (X1/B2). Seguro y
 * matrícula se pueden SUBIR/reemplazar si el rol lo permite (flota/admin, misma
 * regla que la web); para el resto de roles queda solo-lectura. "Otros" docs se
 * ven pero se gestionan desde la web.
 */
@Component({
  selector: 'app-perfil-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, DocSlot],
  templateUrl: './perfil-vehiculo.html',
  styleUrl: './perfil-vehiculo.scss',
})
export class PerfilVehiculoPage {
  private route = inject(ActivatedRoute);
  private vehiculos = inject(VehiculosService);
  private documentos = inject(DocumentosService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);

  loading = signal(true);
  vehiculoId = signal('');
  placa = signal('');
  modelo = signal('');
  fotoUrl = signal<string | null>(null); // U6
  stats = signal<VehiculoStats | null>(null);

  // X1/B2 — documentos del vehículo. Subida gated por rol (flota/admin) igual
  // que la web; los demás roles ven en solo-lectura.
  seguro = signal<DocView | null>(null);
  matricula = signal<DocView | null>(null);
  otros = signal<DocView[]>([]);
  private colaTipos = signal<string[]>([]);

  puedeSubir = computed(() => this.ctx.hasModulo('flota'));
  seguroEnCola = computed(() => this.colaTipos().includes('seguro'));
  matriculaEnCola = computed(() => this.colaTipos().includes('matricula'));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    this.vehiculoId.set(id);
    this.loading.set(true);
    try {
      const [veh, stats] = await Promise.all([
        this.vehiculos.getVehiculo(id),
        this.vehiculos.getVehiculoStats(id),
      ]);
      if (veh) {
        this.placa.set(veh.placa);
        this.modelo.set(`${veh.marca} ${veh.modelo}`);
        if (veh.foto_path) this.fotoUrl.set(await this.vehiculos.getFotoUrl(veh.foto_path));
      }
      this.stats.set(stats);
      await this.loadDocs(id);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadDocs(id: string): Promise<void> {
    if (!id) return;
    const [docs, cola] = await Promise.all([
      this.documentos.getDocumentos('vehiculo', id), // ordenado desc
      this.documentos.tiposEnCola('vehiculo', id),
    ]);
    this.colaTipos.set(cola);
    const toView = async (d: Documento): Promise<DocView> => ({
      label: TIPO_LABEL[d.tipo] ?? d.nombre ?? d.tipo,
      url: await this.documentos.getSignedUrl(d.path),
      esPdf: /\.pdf$/i.test(d.path),
    });
    // El vigente por tipo es el primero (created_at desc).
    const seguro = docs.find((d) => d.tipo === 'seguro') ?? null;
    const matricula = docs.find((d) => d.tipo === 'matricula') ?? null;
    this.seguro.set(seguro ? await toView(seguro) : null);
    this.matricula.set(matricula ? await toView(matricula) : null);
    const otros = docs.filter((d) => d.tipo !== 'seguro' && d.tipo !== 'matricula');
    this.otros.set(await Promise.all(otros.map(toView)));
  }

  /** B2 — subir/reemplazar seguro o matrícula (gated por rol; offline-safe). */
  async onDoc(tipo: 'seguro' | 'matricula', doc: CapturedDoc): Promise<void> {
    const id = this.vehiculoId();
    if (!id || !this.puedeSubir()) return;
    try {
      await this.documentos.enqueueDocumento({ entidad: 'vehiculo', entidadId: id, tipo, doc });
      this.colaTipos.update((t) => (t.includes(tipo) ? t : [...t, tipo]));
      this.toast.success('Documento guardado. Se subirá cuando haya conexión.');
    } catch {
      this.toast.error('No se pudo guardar el documento.');
    }
  }

  back(): void {
    this.location.back();
  }
}
