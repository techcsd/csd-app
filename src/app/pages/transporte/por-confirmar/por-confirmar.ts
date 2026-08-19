import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { CapturedPhoto } from '../../../core/services/camera.service';
import {
  ConducesService,
  EntregaPorConfirmar,
  ConduceDetalleItem,
  ConduceItemLibre,
} from '../../../core/services/conduces.service';
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
  imports: [FormsModule, PhotoSlot, OptionButton, SignaturePad, Skeleton, EmptyState, LiveRefreshDirective],
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
  refrescando = signal(false);
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
  // AU4 — items del conduce traídos del DETALLE al abrir (la lista mis_entregas
  // NO trae items, por eso el flujo por-item estaba muerto). Ahora sí hay qué recibir.
  private detalleItems = signal<ConduceDetalleItem[]>([]);
  // AU4 — items LIBRES (material no catalogado). Se MUESTRAN al recibir (AT11); su
  // cantidad-recibida aún no persiste server-side (tabla aparte sin columna) → sólo
  // informativo hasta el follow-up de backend.
  libres = signal<ConduceItemLibre[]>([]);
  cargandoDetalle = signal(false);

  /** AU4 — items catalogados del conduce que se está confirmando (del detalle). */
  itemsActuales = computed(() => this.detalleItems());

  constructor() {
    void this.load();
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.entregas.set(await this.conduces.misEntregasPorConfirmar());
    } catch {
      this.toast.error('No pudimos cargar las entregas por confirmar.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.load(silent);
  }

  get online(): boolean {
    return this.network.online();
  }

  abrir(id: string): void {
    const abriendo = this.confirmandoId() !== id;
    this.confirmandoId.set(abriendo ? id : '');
    this.foto.set(null);
    this.firmaLista.set(false);
    this.llegoTodo.set(null);
    this.notas.set('');
    this.detalleItems.set([]);
    this.libres.set([]);
    this.cantidades.set({});
    // AU4 — trae el detalle del conduce (items catalogados + libres) para que el
    // flujo "Faltó algo" tenga QUÉ recibir por ítem (la lista no los provee).
    if (abriendo) void this.cargarDetalle(id);
  }

  private async cargarDetalle(id: string): Promise<void> {
    this.cargandoDetalle.set(true);
    try {
      const d = await this.conduces.conduceDetalleApp(id);
      // Ignora si el usuario ya cambió de fila mientras cargaba.
      if (this.confirmandoId() !== id) return;
      this.detalleItems.set(d.items ?? []);
      this.libres.set(d.items_libres ?? []);
      this.resetCantidades(id);
    } catch {
      // Sin red / sin detalle: se degrada al checklist Sí/No (sin bloquear).
    } finally {
      this.cargandoDetalle.set(false);
    }
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
  private resetCantidades(_id: string): void {
    const init: Record<string, number> = {};
    for (const it of this.detalleItems()) init[it.detalle_id] = it.cantidad;
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
