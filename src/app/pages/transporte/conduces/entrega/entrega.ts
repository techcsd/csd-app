import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PhotoSlot } from '../../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { BigConfirm } from '../../../../shared/ui/big-confirm/big-confirm';
import { CapturedPhoto } from '../../../../core/services/camera.service';
import { ConducesService } from '../../../../core/services/conduces.service';
import { NetworkService } from '../../../../core/services/network.service';
import { ToastService } from '../../../../core/services/toast.service';
import { Conduce } from '../../../../core/models/transporte.model';

/**
 * Confirm delivery of one conduce: delivery photo → ¿llegó todo? → (partial
 * quantities) → receiver name + signature. Enqueued offline; closes SGC's
 * despachado → entregado / entregado_incompleto trazabilidad.
 */
@Component({
  selector: 'app-conduce-entrega',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, SignaturePad, BigConfirm],
  templateUrl: './entrega.html',
  styleUrl: './entrega.scss',
})
export class ConduceEntregaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ConducesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  private sig = viewChild(SignaturePad);

  conduce = signal<Conduce | null>(null);
  foto = signal<CapturedPhoto | null>(null);
  llegoTodo = signal<boolean | null>(null);
  cantidades = signal<Record<string, number>>({});
  receptor = signal('');
  submitting = signal(false);
  done = signal(false);

  incompleto = computed(() => {
    const c = this.conduce();
    if (!c) return false;
    return c.items.some((it) => (this.cantidades()[it.detalle_id] ?? it.cantidad) < it.cantidad);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('salidaId');
    const list = await this.service.misConduces();
    const c = list.find((x) => x.id === id) ?? null;
    this.conduce.set(c);
    if (c) {
      const init: Record<string, number> = {};
      for (const it of c.items) init[it.detalle_id] = it.cantidad;
      this.cantidades.set(init);
    }
  }

  onFoto(photo: CapturedPhoto): void {
    this.foto.set(photo);
  }

  setLlegoTodo(value: boolean): void {
    this.llegoTodo.set(value);
    const c = this.conduce();
    if (value && c) {
      const full: Record<string, number> = {};
      for (const it of c.items) full[it.detalle_id] = it.cantidad;
      this.cantidades.set(full);
    }
  }

  setCantidad(detalleId: string, value: number): void {
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.max(0, value || 0) }));
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const c = this.conduce();
    if (!c) return;
    if (!this.foto()) {
      this.toast.error('Toma la foto de la entrega.');
      return;
    }
    if (this.llegoTodo() === null) {
      this.toast.error('Dinos si llegó todo el material.');
      return;
    }
    if (!this.receptor().trim()) {
      this.toast.error('Escribe el nombre de quien recibe.');
      return;
    }
    const firmaBlob = await this.sig()?.toBlob();
    if (!firmaBlob) {
      this.toast.error('Falta la firma de quien recibe.');
      return;
    }

    this.submitting.set(true);
    try {
      await this.service.entregarConduce({
        salidaId: c.id,
        items: c.items.map((it) => ({
          detalle_id: it.detalle_id,
          cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
        })),
        receptor: this.receptor().trim(),
        notas: null,
        fotoEntrega: this.foto()!.blob,
        firma: firmaBlob,
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces']);
  }
}
