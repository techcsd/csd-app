import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PhotoSlot } from '../../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../../core/services/camera.service';
import { ConducesService } from '../../../../core/services/conduces.service';
import { InventarioService, UsuarioBusqueda } from '../../../../core/services/inventario.service';
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
  private inventario = inject(InventarioService);
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
  // AE — ¿el receptor está presente para firmar? Si no, se elige al ingeniero y su
  // firma queda pendiente (se le enruta).
  receptorPresente = signal(true);
  receptorBusqueda = signal('');
  receptorResultados = signal<UsuarioBusqueda[]>([]);
  receptorSel = signal<UsuarioBusqueda | null>(null);
  buscando = signal(false);
  entregaPendiente = signal(false); // resultado: quedó firma de receptor pendiente
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

  // AE — receptor presente / ausente + búsqueda del ingeniero encargado.
  setReceptorPresente(v: boolean): void {
    this.receptorPresente.set(v);
    if (v) {
      this.receptorSel.set(null);
      this.receptorResultados.set([]);
    }
  }
  async buscarReceptor(): Promise<void> {
    const term = this.receptorBusqueda().trim();
    if (term.length < 2) {
      this.receptorResultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      this.receptorResultados.set(await this.inventario.buscarUsuarios(term));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }
  pickReceptor(u: UsuarioBusqueda): void {
    this.receptorSel.set(u);
    this.receptorResultados.set([]);
    this.receptorBusqueda.set(u.nombre);
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

    // AE — receptor presente (firma ahora) o ausente (firma pendiente enrutada).
    let receptorNombre: string;
    let receptorUsuarioId: string | null = null;
    let firmaReceptor: Blob | null = null;
    if (this.receptorPresente()) {
      if (!this.receptor().trim()) {
        this.toast.error('Escribe el nombre de quien recibe.');
        return;
      }
      firmaReceptor = (await this.sigReceptor()?.toBlob()) ?? null;
      if (!firmaReceptor) {
        this.toast.error('Falta la firma de quien recibe.');
        return;
      }
      receptorNombre = this.receptor().trim();
    } else {
      const u = this.receptorSel();
      if (!u) {
        this.toast.error('Elige quién recibe (el ingeniero/encargado).');
        return;
      }
      receptorNombre = u.nombre;
      receptorUsuarioId = u.id;
      firmaReceptor = null; // pendiente
    }

    this.receptor.set(receptorNombre); // que la confirmación muestre el receptor
    this.submitting.set(true);
    try {
      await this.service.entregarConduce({
        salidaId: c.id,
        items: c.items.map((it) => ({
          detalle_id: it.detalle_id,
          cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
        })),
        receptor: receptorNombre,
        notas: null,
        fotoEntrega: this.foto()!.blob,
        firma: firmaReceptor,
        emisorNombre: this.emisorNombre().trim(), // AC7
        firmaEmisor, // AC7
        receptorUsuarioId, // AE
      });
      // AC7 — mostrar ambas firmas en la confirmación (detalle del conduce).
      this.firmaEmisorUrl.set(URL.createObjectURL(firmaEmisor));
      if (firmaReceptor) this.firmaReceptorUrl.set(URL.createObjectURL(firmaReceptor));
      this.entregaPendiente.set(!firmaReceptor);
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
