import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PhotoSlot } from '../../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../../core/services/camera.service';
import { ConducesService } from '../../../../core/services/conduces.service';
import { NetworkService } from '../../../../core/services/network.service';
import { ToastService } from '../../../../core/services/toast.service';
import { UserContextService } from '../../../../core/services/user-context.service';
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
  imports: [FormsModule, PhotoSlot, OptionButton, SignaturePad, Skeleton],
  templateUrl: './entrega.html',
  styleUrl: './entrega.scss',
})
export class ConduceEntregaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ConducesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);

  // AC7 — dos firmas: emisor (quien entrega) y receptor (quien recibe).
  private sigEmisor = viewChild<SignaturePad>('emisorPad');
  private sigReceptor = viewChild<SignaturePad>('receptorPad');

  conduce = signal<Conduce | null>(null);
  loading = signal(true);
  foto = signal<CapturedPhoto | null>(null);
  llegoTodo = signal<boolean | null>(null);
  cantidades = signal<Record<string, number>>({});
  receptor = signal('');
  // AC7 — nombre de quien entrega, precargado con el usuario logueado.
  emisorNombre = signal('');
  firmaEmisorLista = signal(false);
  firmaReceptorLista = signal(false);
  submitting = signal(false);
  done = signal(false);
  // AC7 — vista previa de ambas firmas en la confirmación (detalle del conduce).
  firmaEmisorUrl = signal<string | null>(null);
  firmaReceptorUrl = signal<string | null>(null);

  incompleto = computed(() => {
    const c = this.conduce();
    if (!c) return false;
    return c.items.some((it) => (this.cantidades()[it.detalle_id] ?? it.cantidad) < it.cantidad);
  });

  constructor() {
    // AC7 — precargar el nombre del emisor con el usuario logueado (editable).
    this.emisorNombre.set(this.ctx.nombre());
    void this.load();
  }

  onFirmaEmisor(has: boolean): void {
    this.firmaEmisorLista.set(has);
  }
  onFirmaReceptor(has: boolean): void {
    this.firmaReceptorLista.set(has);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const id = this.route.snapshot.paramMap.get('salidaId');
      const list = await this.service.misConduces();
      const c = list.find((x) => x.id === id) ?? null;
      this.conduce.set(c);
      if (c) {
        const init: Record<string, number> = {};
        for (const it of c.items) init[it.detalle_id] = it.cantidad;
        this.cantidades.set(init);
      }
    } finally {
      this.loading.set(false);
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
    // APP-032: la cantidad recibida no puede superar lo despachado.
    const max = this.conduce()?.items.find((it) => it.detalle_id === detalleId)?.cantidad ?? Infinity;
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.min(max, Math.max(0, value || 0)) }));
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
    // AC7 — quien entrega + su firma.
    if (!this.emisorNombre().trim()) {
      this.toast.error('Escribe el nombre de quien entrega.');
      return;
    }
    const firmaEmisor = await this.sigEmisor()?.toBlob();
    if (!firmaEmisor) {
      this.toast.error('Falta la firma de quien entrega.');
      return;
    }
    if (!this.receptor().trim()) {
      this.toast.error('Escribe el nombre de quien recibe.');
      return;
    }
    const firmaBlob = await this.sigReceptor()?.toBlob();
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
        emisorNombre: this.emisorNombre().trim(), // AC7
        firmaEmisor, // AC7
      });
      // AC7 — mostrar ambas firmas en la confirmación (detalle del conduce).
      this.firmaEmisorUrl.set(URL.createObjectURL(firmaEmisor));
      this.firmaReceptorUrl.set(URL.createObjectURL(firmaBlob));
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces'], { replaceUrl: true });
  }
}
