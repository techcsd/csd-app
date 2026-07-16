import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { VehiculoStats } from '../../../core/models/transporte.model';
import { Documento } from '../../../core/models/documento.model';

/** A document ready to render read-only (label + signed URL). */
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

/** Read-only vehicle profile: info + aggregated stats (R4) + documents (X1). */
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
  private location = inject(Location);

  loading = signal(true);
  placa = signal('');
  modelo = signal('');
  fotoUrl = signal<string | null>(null); // U6
  stats = signal<VehiculoStats | null>(null);

  // X1 — documentos del vehículo (SOLO LECTURA; se suben desde la web).
  seguro = signal<DocView | null>(null);
  matricula = signal<DocView | null>(null);
  otros = signal<DocView[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
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
    const docs = await this.documentos.getDocumentos('vehiculo', id); // ordenado desc
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

  back(): void {
    this.location.back();
  }
}
