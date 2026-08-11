import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, EntregaPorConfirmar } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
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
  private navGuard = inject(NavGuardService);
  private router = inject(Router);

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
  // QA-13 — cantidades recibidas por item (editables cuando "Faltó algo").
  cantidades = signal<Record<string, number>>({});

  /** QA-13 — items del conduce que se está confirmando (si el RPC los provee). */
  itemsActuales = computed(
    () => this.entregas().find((e) => e.id === this.confirmandoId())?.items ?? [],
  );

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
    this.resetCantidades(id); // QA-13
  }

  onFirma(has: boolean): void {
    this.firmaLista.set(has);
  }

  /** AL8 — ver el documento completo del conduce ANTES de confirmar (items
   *  esperados, origen/destino, chofer, fotos de entrega, firmas). */
  verConduce(id: string): void {
    void this.router.navigate(['/transporte/conduce-detalle', id]);
  }

  /** AL8 — historial del propio confirmador (accesible aunque no sea flota). */
  misConfirmaciones(): void {
    void this.router.navigate(['/transporte/confirmaciones']);
  }

  // ── QA-13 — registrar QUÉ y CUÁNTO llegó cuando "Faltó algo" ────────────────
  /** Reinicia las cantidades a las del conduce (todo recibido) para una entrega. */
  private resetCantidades(id: string): void {
    const e = this.entregas().find((x) => x.id === id);
    const init: Record<string, number> = {};
    for (const it of e?.items ?? []) init[it.detalle_id] = it.cantidad;
    this.cantidades.set(init);
  }

  setLlegoTodo(value: boolean): void {
    this.llegoTodo.set(value);
    // "Sí, todo" restaura las cantidades completas del conduce.
    if (value) this.resetCantidades(this.confirmandoId());
  }

  setCantidad(detalleId: string, value: number): void {
    const max = this.itemsActuales().find((it) => it.detalle_id === detalleId)?.cantidad ?? Infinity;
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.min(max, Math.max(0, value || 0)) }));
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
    // QA-13 — si faltó algo y tenemos el detalle del conduce, registramos las
    // cantidades recibidas por item. Sin items (offline / RPC no los provee) se
    // degrada al checklist Sí/No sin bloquear la confirmación.
    const items =
      this.llegoTodo() === false && this.itemsActuales().length
        ? this.itemsActuales().map((it) => ({
            detalle_id: it.detalle_id,
            cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
          }))
        : null;
    this.enviando.set(true);
    try {
      // QA-13 BACKEND: verify conduce_confirmar_receptor applies p_items
      await this.conduces.conduceConfirmarReceptor({
        salidaId: id,
        foto: this.foto()!.blob,
        firma,
        checklist: { llego_todo: this.llegoTodo() === true },
        items,
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
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
