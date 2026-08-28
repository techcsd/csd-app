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
  ConduceDetalleItem,
  ConduceItemLibre,
} from '../../../core/services/conduces.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';
import { EntregaPorRecibir, fusionarEntregasPorRecibir } from '../../../core/util/recepcion';

/**
 * BD2 — bandeja CANÓNICA del receptor: "Entregas por recibir". Fusiona las dos
 * colas antiguas ("por confirmar" AJ8 + "por firmar" AE) en UNA sola lista
 * deduplicada. Recibir = VER el conduce + FOTO de lo recibido + FIRMA (identidad de
 * sesión, no editable). La foto es obligatoria pero no bloqueante (si no se puede,
 * se exige una nota). Todo viaja como UNA operación por el outbox (offline-safe).
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
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private router = inject(Router);

  private sigPad = viewChild<SignaturePad>('receptorPad');

  fmtFecha = formatFecha;
  nombreSesion = this.ctx.nombre; // BD2 — la firma va a nombre del usuario logueado

  loading = signal(true);
  refrescando = signal(false);
  entregas = signal<EntregaPorRecibir[]>([]);

  // Fila expandida en modo recepción.
  confirmandoId = signal('');
  foto = signal<CapturedPhoto | null>(null);
  firmaLista = signal(false);
  llegoTodo = signal<boolean | null>(null);
  notas = signal('');
  enviando = signal(false);
  // QA-13 — cantidades recibidas por item (editables cuando "Faltó algo").
  cantidades = signal<Record<string, number>>({});
  // AU4 — items del conduce traídos del DETALLE al abrir.
  private detalleItems = signal<ConduceDetalleItem[]>([]);
  libres = signal<ConduceItemLibre[]>([]);
  cargandoDetalle = signal(false);

  /** AU4 — items catalogados del conduce que se está recibiendo (del detalle). */
  itemsActuales = computed(() => this.detalleItems());

  constructor() {
    void this.load();
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      // BD2 — fusiona las dos fuentes en una sola bandeja deduplicada por salida.
      const [confirmar, firmar] = await Promise.all([
        this.conduces.misEntregasPorConfirmar(),
        this.inventario.misFirmasPendientes(),
      ]);
      this.entregas.set(fusionarEntregasPorRecibir(confirmar, firmar));
    } catch {
      this.toast.error('No pudimos cargar las entregas por recibir.');
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

  /** AL8 — ver el documento completo del conduce ANTES de recibir (items
   *  esperados, origen/destino, chofer, fotos de entrega, firmas). */
  verConduce(id: string): void {
    void this.router.navigate(['/transporte/conduce-detalle', id]);
  }

  /** AL8 — historial del propio confirmador (accesible aunque no sea flota). */
  misConfirmaciones(): void {
    void this.router.navigate(['/transporte/confirmaciones']);
  }

  // ── QA-13 — registrar QUÉ y CUÁNTO llegó cuando "Faltó algo" ────────────────
  private resetCantidades(_id: string): void {
    const init: Record<string, number> = {};
    for (const it of this.detalleItems()) init[it.detalle_id] = it.cantidad;
    this.cantidades.set(init);
  }

  setLlegoTodo(value: boolean): void {
    this.llegoTodo.set(value);
    if (value) this.resetCantidades(this.confirmandoId());
  }

  setCantidad(detalleId: string, value: number): void {
    const max = this.itemsActuales().find((it) => it.detalle_id === detalleId)?.cantidad ?? Infinity;
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.min(max, Math.max(0, value || 0)) }));
  }

  async confirmar(e: EntregaPorRecibir): Promise<void> {
    if (this.enviando()) return;
    const firma = await this.sigPad()?.toBlob();
    if (!firma) {
      this.toast.error('Falta tu firma de recepción.');
      return;
    }
    const foto = this.foto();
    const notas = this.notas().trim();
    // BD2 — foto obligatoria pero NO bloqueante: si no hay foto, se exige una nota.
    if (!foto && !notas) {
      this.toast.error('Toma la foto de lo recibido; si no puedes, explica por qué en las notas.');
      return;
    }
    this.enviando.set(true);
    try {
      if (e.fuente === 'confirmar') {
        if (this.llegoTodo() === null) {
          this.toast.error('Dinos si llegó todo el material.');
          this.enviando.set(false);
          return;
        }
        // QA-13 — si faltó algo y tenemos el detalle, registra cantidades por item.
        const items =
          this.llegoTodo() === false && this.itemsActuales().length
            ? this.itemsActuales().map((it) => ({
                detalle_id: it.detalle_id,
                cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
              }))
            : null;
        await this.conduces.conduceConfirmarReceptor({
          salidaId: e.salidaId,
          foto: foto?.blob ?? null,
          firma,
          checklist: { llego_todo: this.llegoTodo() === true },
          items,
          notas: notas || null,
        });
      } else {
        // BD2 — fuente "por firmar": firma + foto (nombre de la sesión, no editable).
        await this.inventario.enqueueFirmarReceptor({
          salidaId: e.salidaId,
          nombre: this.nombreSesion() || 'Receptor',
          firma,
          foto: foto?.blob ?? null,
          nota: notas || null,
        });
      }
      this.toast.success('¡Recepción confirmada! Se avisó al chofer.');
      this.confirmandoId.set('');
      this.entregas.update((list) => list.filter((x) => x.salidaId !== e.salidaId));
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'No se pudo confirmar. Intenta de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
