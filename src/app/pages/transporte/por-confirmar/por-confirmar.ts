import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, EntregaPorConfirmar } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

/**
 * AJ8 — bandeja del RECEPTOR: entregas que el chofer marcó como entregadas y que
 * el receptor debe CONFIRMAR desde SU PROPIO teléfono (foto + firma + ¿llegó
 * todo?). El servidor impide que confirme quien entregó (antisuplantación).
 * Offline-safe por outbox.
 */
@Component({
  selector: 'app-por-confirmar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, SignaturePad, Skeleton, EmptyState],
  templateUrl: './por-confirmar.html',
  styleUrl: './por-confirmar.scss',
})
export class PorConfirmarPage {
  private conduces = inject(ConducesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private sigPad = viewChild<SignaturePad>('receptorPad');

  fmtFecha = formatFecha;

  loading = signal(true);
  entregas = signal<EntregaPorConfirmar[]>([]);

  // Fila expandida en modo confirmación.
  confirmandoId = signal('');
  foto = signal<CapturedPhoto | null>(null);
  firmaLista = signal(false);
  llegoTodo = signal<boolean | null>(null);
  notas = signal('');
  enviando = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.entregas.set(await this.conduces.misEntregasPorConfirmar());
    } catch {
      this.toast.error('No pudimos cargar las entregas por confirmar.');
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  abrir(id: string): void {
    this.confirmandoId.set(this.confirmandoId() === id ? '' : id);
    this.foto.set(null);
    this.firmaLista.set(false);
    this.llegoTodo.set(null);
    this.notas.set('');
  }

  onFirma(has: boolean): void {
    this.firmaLista.set(has);
  }

  async confirmar(id: string): Promise<void> {
    if (this.enviando()) return;
    if (!this.foto()) {
      this.toast.error('Toma la foto del material recibido.');
      return;
    }
    if (this.llegoTodo() === null) {
      this.toast.error('Dinos si llegó todo el material.');
      return;
    }
    const firma = await this.sigPad()?.toBlob();
    if (!firma) {
      this.toast.error('Falta tu firma de confirmación.');
      return;
    }
    this.enviando.set(true);
    try {
      await this.conduces.conduceConfirmarReceptor({
        salidaId: id,
        foto: this.foto()!.blob,
        firma,
        checklist: { llego_todo: this.llegoTodo() === true },
        notas: this.notas().trim() || null,
      });
      this.toast.success('¡Recepción confirmada! Se avisó al chofer.');
      this.confirmandoId.set('');
      this.entregas.update((list) => list.filter((e) => e.id !== id));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo confirmar. Intenta de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
