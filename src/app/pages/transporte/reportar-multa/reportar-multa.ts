import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { CameraService, CapturedDoc } from '../../../core/services/camera.service';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';

/** Estado del formulario persistido (sin el blob del documento, que va aparte). */
interface MultaDraft {
  motivo: string;
  monto: number | null;
  estado: 'pendiente' | 'pagada';
  vehiculoId: string | null;
  doc: { nombre: string; esImagen: boolean; ext: string } | null;
}

/**
 * S24 — registrar una multa de un conductor (motivo, monto opcional, documento).
 * Por outbox (registrar_multa_app). Alcanzable desde el perfil del conductor.
 *
 * U9 — autosave del formulario (recupera todo si el picker de archivo mata el
 * proceso en MIUI), preview del documento, y selector de vehículo (default: tu
 * vehículo asignado actual) para relacionar la multa al vehículo.
 */
@Component({
  selector: 'app-reportar-multa',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, BigConfirm],
  templateUrl: './reportar-multa.html',
  styleUrl: './reportar-multa.scss',
})
export class ReportarMultaPage {
  private route = inject(ActivatedRoute);
  private reportes = inject(FlotaReportesService);
  private vehiculos = inject(VehiculosService);
  private camera = inject(CameraService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  conductorId = '';
  motivo = signal('');
  monto = signal<number | null>(null);
  estado = signal<'pendiente' | 'pagada'>('pendiente');
  documento = signal<CapturedDoc | null>(null);
  vehiculoId = signal<string | null>(null);
  flota = signal<VehiculoDisponible[]>([]);
  submitting = signal(false);
  done = signal(false);
  borradorPrevio = signal(false); // banner "recuperamos lo que llenaste"

  private hydrated = false;

  private get clave(): string {
    return `multa:${this.conductorId}`;
  }

  constructor() {
    this.conductorId = this.route.snapshot.paramMap.get('conductorId') ?? '';
    void this.init();
    // Autosave del formulario (debounce + flush al ocultar). Antes de hidratar no
    // guardamos para no pisar el borrador con el estado vacío inicial.
    effect(() => {
      const snap: MultaDraft = {
        motivo: this.motivo(),
        monto: this.monto(),
        estado: this.estado(),
        vehiculoId: this.vehiculoId(),
        doc: this.documento()
          ? { nombre: this.documento()!.nombre, esImagen: this.documento()!.esImagen, ext: this.documento()!.ext }
          : null,
      };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'multa', etiqueta: 'Multa de conductor', ruta: this.location.path() });
    });
  }

  private async init(): Promise<void> {
    // Flota para el selector + default = mi vehículo asignado actual.
    const [flota, asignaciones, draft] = await Promise.all([
      this.vehiculos.getFlota().catch(() => [] as VehiculoDisponible[]),
      this.vehiculos.getMisAsignaciones().catch(() => []),
      this.borrador.load<MultaDraft>(this.clave),
    ]);
    this.flota.set(flota);

    if (draft) {
      // Restaurar lo que el usuario llenó antes de que el proceso muriera.
      this.motivo.set(draft.motivo ?? '');
      this.monto.set(draft.monto ?? null);
      this.estado.set(draft.estado ?? 'pendiente');
      this.vehiculoId.set(draft.vehiculoId ?? null);
      if (draft.doc) {
        const fotos = await this.borrador.loadFotos(this.clave);
        const f = fotos.find((x) => x.slot === 'doc');
        if (f) {
          this.documento.set({
            blob: f.blob,
            nombre: draft.doc.nombre,
            esImagen: draft.doc.esImagen,
            ext: draft.doc.ext,
            previewUrl: draft.doc.esImagen ? URL.createObjectURL(f.blob) : null,
          });
        }
      }
      this.borradorPrevio.set(true);
    } else if (asignaciones.length) {
      this.vehiculoId.set(asignaciones[0].vehiculo_id);
    }
    this.hydrated = true;
  }

  async subirDoc(desdeArchivo: boolean): Promise<void> {
    // U9 — persistir el borrador ANTES de abrir cámara/picker: en MIUI el selector
    // nativo recrea la Activity y mata el proceso; al reabrir restauramos todo.
    await this.autosave.flushAll();
    const doc = desdeArchivo ? await this.camera.pickDocument() : await this.camera.takeDocumentPhoto();
    if (doc) {
      this.documento.set(doc);
      // Persistir el blob del documento aparte (WebKit-safe) para recuperarlo.
      await this.borrador.saveFoto(this.clave, 'doc', doc.blob);
    }
  }

  async quitarDoc(): Promise<void> {
    const prev = this.documento();
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    this.documento.set(null);
    await this.borrador.removeFoto(this.clave, 'doc');
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.conductorId) {
      this.toast.error('Falta el conductor.');
      return;
    }
    if (!this.motivo().trim()) {
      this.toast.error('Escribe el motivo de la multa.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.reportes.enqueueMulta({
        conductorId: this.conductorId,
        vehiculoId: this.vehiculoId(),
        motivo: this.motivo().trim(),
        monto: this.monto(),
        estado: this.estado(),
        documento: this.documento() ? { blob: this.documento()!.blob, ext: this.documento()!.ext } : null,
      });
      await this.autosave.discard(this.clave); // limpia borrador + fotos
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
