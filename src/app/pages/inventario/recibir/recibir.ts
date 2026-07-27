import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { InventarioService } from '../../../core/services/inventario.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
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
  imports: [Skeleton, EmptyState, FormsModule, DecimalPipe, SyncBar, PhotoSlot],
  templateUrl: './recibir.html',
  styleUrl: './recibir.scss',
})
export class RecibirConducePage {
  private inventario = inject(InventarioService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  private readonly clave = 'inventario:recibir';
  private hydrated = false;

  readonly fechaHora = formatFechaCortaHora;

  conduces = signal<Conduce[]>([]);
  loading = signal(true);
  /** Conduce abierto en la hoja de detalle (null = vista lista). */
  activo = signal<Conduce | null>(null);
  cantidades = signal<Record<string, number>>({});
  foto = signal<CapturedPhoto | null>(null);
  notas = signal(''); // APP-041 — discrepancias de recepción
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
      this.conduces.set(await this.inventario.conducesPorRecibir());
      await this.restoreDraft();
    } finally {
      this.loading.set(false);
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

  async confirm(): Promise<void> {
    const c = this.activo();
    if (!c || this.submitting()) return;
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
