import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { Img } from '../../../shared/ui/img/img';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { SyncService } from '../../../core/sync/sync.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { VehiculoStats } from '../../../core/models/transporte.model';
import { Documento } from '../../../core/models/documento.model';
import { Conductor } from '../../../core/models/conductor.model';
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
  imports: [DecimalPipe, Skeleton, EmptyState, DocSlot, SelectList, Img],
  templateUrl: './perfil-vehiculo.html',
  styleUrl: './perfil-vehiculo.scss',
})
export class PerfilVehiculoPage {
  private route = inject(ActivatedRoute);
  private vehiculos = inject(VehiculosService);
  private sync = inject(SyncService);
  private documentos = inject(DocumentosService);
  private conductores = inject(ConductoresService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  vehiculoId = signal('');
  placa = signal('');
  modelo = signal('');
  fotoUrl = signal<string | null>(null); // U6
  stats = signal<VehiculoStats | null>(null);
  // V1/V2 — identificadores + pólizas del vehículo.
  vin = signal<string | null>(null);
  numeroMatricula = signal<string | null>(null);
  numeroSeguro = signal<string | null>(null);
  aseguradora = signal<string | null>(null);

  // X1/B2 — documentos del vehículo. Subida gated por rol (flota/admin) igual
  // que la web; los demás roles ven en solo-lectura.
  seguro = signal<DocView | null>(null);
  matricula = signal<DocView | null>(null);
  otros = signal<DocView[]>([]);
  private colaTipos = signal<string[]>([]);

  puedeSubir = computed(() => this.ctx.hasModulo('flota'));
  seguroEnCola = computed(() => this.colaTipos().includes('seguro'));
  matriculaEnCola = computed(() => this.colaTipos().includes('matricula'));

  // Gestión (admin): editar vehículo + asignar a un conductor.
  esAdmin = () => this.ctx.hasModulo('admin');
  private conductores_ = signal<Conductor[]>([]);
  conductorSel = signal('');
  asignando = signal(false);
  conductorOpts = computed<SelectOption[]>(() =>
    this.conductores_().map((c) => ({ id: c.id, label: c.cedula ? `${c.nombre} · ${c.cedula}` : c.nombre })),
  );

  private primerCambio = true;

  constructor() {
    void this.load();
    // P7 — tras drenar el outbox (pre-uso/entrega/combustible/mantenimiento con
    // km), refrescar en silencio las stats para mostrar el km nuevo sin flicker.
    effect(() => {
      this.sync.changed();
      if (this.primerCambio) {
        this.primerCambio = false;
        return;
      }
      void this.refrescarStats();
    });
  }

  private async refrescarStats(): Promise<void> {
    const id = this.vehiculoId();
    if (!id) return;
    try {
      this.stats.set(await this.vehiculos.getVehiculoStats(id));
    } catch {
      /* best-effort: si falla, se mantiene el valor actual */
    }
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
        this.vin.set(veh.vin);
        this.numeroMatricula.set(veh.numero_matricula);
        this.numeroSeguro.set(veh.numero_seguro);
        this.aseguradora.set(veh.aseguradora);
        if (veh.foto_path) this.fotoUrl.set(await this.vehiculos.getFotoUrl(veh.foto_path));
      }
      this.stats.set(stats);
      await this.loadDocs(id);
      if (this.esAdmin()) {
        try {
          this.conductores_.set(await this.conductores.getConductores());
        } catch {
          /* best-effort: sin lista igual se puede ver el perfil */
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  editar(): void {
    void this.router.navigate(['/transporte/vehiculos', this.vehiculoId(), 'editar']);
  }

  /** S22 — reportar accidente o daño de este vehículo. */
  reportar(): void {
    void this.router.navigate(['/transporte/vehiculo', this.vehiculoId(), 'reportar']);
  }

  /** Asignar este vehículo a un conductor (admin). */
  async asignar(): Promise<void> {
    if (this.asignando()) return;
    const conductor = this.conductores_().find((c) => c.id === this.conductorSel());
    if (!conductor) {
      this.toast.error('Elige un conductor.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para asignar.');
      return;
    }
    this.asignando.set(true);
    try {
      await this.vehiculos.asignarAConductor(this.vehiculoId(), conductor.id, conductor.usuario_id);
      this.toast.success(`Vehículo asignado a ${conductor.nombre}.`);
      this.conductorSel.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo asignar.');
    } finally {
      this.asignando.set(false);
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
