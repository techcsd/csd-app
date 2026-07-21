import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { CameraService, CapturedDoc } from '../../../core/services/camera.service';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * S24 — registrar una multa de un conductor (motivo, monto opcional, documento).
 * Por outbox (registrar_multa_app). Alcanzable desde el perfil del conductor.
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
  private camera = inject(CameraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  conductorId = '';
  motivo = signal('');
  monto = signal<number | null>(null);
  estado = signal<'pendiente' | 'pagada'>('pendiente');
  documento = signal<CapturedDoc | null>(null);
  submitting = signal(false);
  done = signal(false);

  constructor() {
    this.conductorId = this.route.snapshot.paramMap.get('conductorId') ?? '';
  }

  async subirDoc(desdeArchivo: boolean): Promise<void> {
    const doc = desdeArchivo ? await this.camera.pickDocument() : await this.camera.takeDocumentPhoto();
    if (doc) this.documento.set(doc);
  }
  quitarDoc(): void {
    this.documento.set(null);
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
        vehiculoId: null,
        motivo: this.motivo().trim(),
        monto: this.monto(),
        estado: this.estado(),
        documento: this.documento() ? { blob: this.documento()!.blob, ext: this.documento()!.ext } : null,
      });
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
