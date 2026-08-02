import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { InventarioService, EntradaFerreteriaPendiente } from '../../../core/services/inventario.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Conduce } from '../../../core/models/transporte.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';

/** Estado serializable de la recepción abierta (regla 4 — autosave/borrador). */
interface RecibirDraft {
  expandedId: string;
  cantidades: Record<string, number>;
  notas: string;
}

/** Z20 — bodeguero/chofer confirma la recepción de un conduce despachado.
 *  Presentación clara: lista con encabezado legible → hoja de detalle con
 *  origen→destino, quién/cuándo, ítems recibido/esperado editables, notas,
 *  fotos y confirmación tipo hoja. Offline-first. */
@Component({
  selector: 'app-recibir-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, FormsModule, DecimalPipe, SyncBar, PhotoSlot, SignaturePad],
  templateUrl: './recibir.html',
  styleUrl: './recibir.scss',
})
export class RecibirConducePage {
  private inventario = inject(InventarioService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private ctx = inject(UserContextService);

  private sig = viewChild(SignaturePad);

  private readonly clave = 'inventario:recibir';
  private hydrated = false;

  readonly fechaHora = formatFechaCortaHora;

  conduces = signal<Conduce[]>([]);
  // AE — compras de ferretería pendientes. El chofer las VE (solo lectura); solo
  // Almacén/Inventario les da entrada (antifraude: Almacén valida antes de subir stock).
  entradasFerreteria = signal<EntradaFerreteriaPendiente[]>([]);
  confirmandoId = signal<string | null>(null);
  puedeConfirmarEntrada = computed(() => this.ctx.hasModulo('inventario') || this.ctx.hasRol('admin'));
  loading = signal(true);
  /** Conduce abierto en la hoja de detalle (null = vista lista). */
  activo = signal<Conduce | null>(null);
  cantidades = signal<Record<string, number>>({});
  foto = signal<CapturedPhoto | null>(null);
  notas = signal(''); // APP-041 — discrepancias de recepción
  // AE — firma del receptor (prueba de recepción, AC7).
  receptorNombre = signal('');
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  submitting = signal(false);
  /** Z20 — URL firmada de la foto del despacho (si la hay) + lightbox. */
  despachoFotoUrl = signal<string | null>(null);
  lightbox = signal(false);

  /** Z20 — ¿alguna cantidad recibida difiere de la esperada? (discrepancia). */
  hayDiscrepancia = computed(() => {
    const c = this.activo();
    if (!c) return false;
    return c.items.some((it) => (this.cantidades()[it.detalle_id] ?? it.cantidad) !== it.cantidad);
  });

  constructor() {
    void this.load();
    // Regla 4 — autosave: no perder las cantidades recibidas / notas de discrepancia
    // si el SO mata la app al abrir la cámara (foto de recepción).
    effect(() => {
      const c = this.activo();
      const snap: RecibirDraft = {
        expandedId: c?.id ?? '',
        cantidades: this.cantidades(),
        notas: this.notas(),
      };
      if (!this.hydrated || this.submitting() || !snap.expandedId) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'recibir',
        etiqueta: 'Recepción de conduce',
        ruta: this.location.path(),
      });
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [conduces, entradas] = await Promise.all([
        this.inventario.conducesPorRecibir(),
        this.inventario.misEntradasFerreteriaPendientes().catch(() => [] as EntradaFerreteriaPendiente[]),
      ]);
      this.conduces.set(conduces);
      this.entradasFerreteria.set(entradas);
      await this.restoreDraft();
    } finally {
      this.loading.set(false);
    }
  }

  /** AE — dar entrada (materializar stock) a una compra de ferretería propia. */
  async confirmarEntrada(e: EntradaFerreteriaPendiente): Promise<void> {
    if (this.confirmandoId()) return;
    this.confirmandoId.set(e.id);
    try {
      await this.inventario.enqueueConfirmarEntradaFerreteria(
        e.id,
        e.items.map((i) => ({ articulo_id: i.articulo_id, cantidad: i.cantidad })),
      );
      this.entradasFerreteria.update((list) => list.filter((x) => x.id !== e.id));
      this.toast.success('Entrada registrada. Se sube al stock al sincronizar.');
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'No se pudo dar entrada.');
    } finally {
      this.confirmandoId.set(null);
    }
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<RecibirDraft>(this.clave);
    // Solo se retoma si el conduce sigue pendiente de recibir.
    const c = d?.expandedId ? this.conduces().find((x) => x.id === d.expandedId) : null;
    if (d && c) {
      this.cantidades.set(d.cantidades ?? {});
      this.notas.set(d.notas ?? '');
      this.abrir(c, true);
    } else if (d) {
      void this.autosave.discard(this.clave); // borrador huérfano
    }
    this.hydrated = true;
  }

  /** Z20 — abre la hoja de detalle de un conduce. `retomando` conserva las
   *  cantidades/notas del borrador; en apertura normal se pre-llena con lo esperado. */
  abrir(c: Conduce, retomando = false): void {
    if (!retomando) {
      const init: Record<string, number> = {};
      for (const it of c.items) init[it.detalle_id] = it.cantidad;
      this.cantidades.set(init);
      this.notas.set('');
      this.foto.set(null);
    }
    // AE — precarga el receptor con el usuario logueado y limpia la firma (la firma
    // no se persiste en el borrador: se re-firma al retomar).
    if (!this.receptorNombre().trim()) this.receptorNombre.set(this.ctx.nombre() || '');
    this.firmaLista.set(false);
    this.firmaBlob.set(null);
    this.activo.set(c);
    this.despachoFotoUrl.set(null);
    this.lightbox.set(false);
    void this.resolveDespachoFoto(c);
  }

  /** Z20 — resuelve la foto del despacho a URL firmada (best-effort, online). */
  private async resolveDespachoFoto(c: Conduce): Promise<void> {
    if (!c.foto_path) return;
    const url = await this.inventario.getFotoUrl(c.foto_path);
    if (url && this.activo()?.id === c.id) this.despachoFotoUrl.set(url);
  }

  /** Vuelve a la lista desde la hoja de detalle. */
  cerrarDetalle(): void {
    this.activo.set(null);
    this.lightbox.set(false);
  }

  setCantidad(detalleId: string, v: number): void {
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.max(0, v || 0) }));
  }

  ajustar(detalleId: string, delta: number): void {
    const actual = this.cantidades()[detalleId] ?? 0;
    this.setCantidad(detalleId, actual + delta);
  }

  /** Z20 — ¿esta línea difiere de lo esperado? (para marcar la fila). */
  difiere(it: { detalle_id: string; cantidad: number }): boolean {
    return (this.cantidades()[it.detalle_id] ?? it.cantidad) !== it.cantidad;
  }

  onFoto(p: CapturedPhoto): void {
    this.foto.set(p);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

  /** AE — firma del receptor capturada en el pad. */
  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    this.firmaBlob.set(hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  async confirm(): Promise<void> {
    const c = this.activo();
    if (!c || this.submitting()) return;
    // AE — el receptor debe firmar la recepción (prueba de entrega, AC7).
    if (!this.receptorNombre().trim()) {
      this.toast.error('Escribe el nombre de quien recibe.');
      return;
    }
    if (!this.firmaBlob()) {
      this.toast.error('Falta la firma de quien recibe.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.inventario.enqueueRecepcion({
        salidaId: c.id,
        items: c.items.map((it) => ({
          detalle_id: it.detalle_id,
          cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
        })),
        notas: this.notas().trim() || null,
        foto: this.foto()?.blob ?? null,
        firmaReceptor: this.firmaBlob(),
        receptorNombre: this.receptorNombre().trim(),
      });
      void this.autosave.discard(this.clave); // borrador enviado → limpiar
      this.conduces.update((list) => list.filter((x) => x.id !== c.id));
      this.cerrarDetalle();
      this.toast.success('Recepción guardada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    if (this.activo()) {
      this.cerrarDetalle();
      return;
    }
    this.location.back();
  }
}
