import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { Conduce } from '../../../core/models/transporte.model';

/** Estado serializable de la recepción abierta (regla 4 — autosave/borrador). */
interface RecibirDraft {
  expandedId: string;
  cantidades: Record<string, number>;
  notas: string;
}

/** Bodeguero confirms receipt of a dispatched conduce (offline-first). */
@Component({
  selector: 'app-recibir-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, FormsModule, SyncBar],
  templateUrl: './recibir.html',
  styleUrl: './recibir.scss',
})
export class RecibirConducePage {
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  private readonly clave = 'inventario:recibir';
  private hydrated = false;

  conduces = signal<Conduce[]>([]);
  loading = signal(true);
  expandedId = signal<string | null>(null);
  cantidades = signal<Record<string, number>>({});
  foto = signal<CapturedPhoto | null>(null);
  notas = signal(''); // APP-041 — discrepancias de recepción
  capturing = signal(false);
  submitting = signal(false);

  constructor() {
    void this.load();
    // Regla 4 — autosave: no perder las cantidades recibidas / notas de discrepancia
    // si el SO mata la app al abrir la cámara (foto de recepción).
    effect(() => {
      const snap: RecibirDraft = {
        expandedId: this.expandedId() ?? '',
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
    if (d?.expandedId && this.conduces().some((c) => c.id === d.expandedId)) {
      this.cantidades.set(d.cantidades ?? {});
      this.notas.set(d.notas ?? '');
      this.expandedId.set(d.expandedId);
    } else if (d) {
      void this.autosave.discard(this.clave); // borrador huérfano
    }
    this.hydrated = true;
  }

  toggle(c: Conduce): void {
    if (this.expandedId() === c.id) {
      this.expandedId.set(null);
      return;
    }
    const init: Record<string, number> = {};
    for (const it of c.items) init[it.detalle_id] = it.cantidad;
    this.cantidades.set(init);
    this.foto.set(null);
    this.expandedId.set(c.id);
  }

  setCantidad(detalleId: string, v: number): void {
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.max(0, v || 0) }));
  }

  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const p = await this.camera.takePhoto();
      if (p) this.foto.set(p);
    } finally {
      this.capturing.set(false);
    }
  }

  async confirm(c: Conduce): Promise<void> {
    if (this.submitting()) return;
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
      this.expandedId.set(null);
      this.toast.success('Recepción guardada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
