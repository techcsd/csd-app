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
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { MotionService } from '../../../core/services/motion.service';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

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
  imports: [FormsModule, PhotoSlot, OptionButton, SignaturePad, Skeleton, EmptyState, LiveRefreshDirective, TranslatePipe, ...MOTION_DIRECTIVES],
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
  private i18n = inject(I18nService);
  private motion = inject(MotionService);

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
  // BR4 — rechazo de la entrega (motivo obligatorio + foto opcional).
  modoRechazo = signal(false);
  motivoRechazo = signal('');
  fotoRechazo = signal<CapturedPhoto | null>(null);
  rechazando = signal(false);
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
      const fusionadas = fusionarEntregasPorRecibir(confirmar, firmar);
      this.entregas.set(fusionadas);
      void this.enriquecerFases(fusionadas); // CM4 — resuelve la fase de las que no la traen
    } catch {
      this.toast.error(this.i18n.t('No pudimos cargar las entregas por recibir.'));
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /**
   * CM4 — la fuente 'firmar' (receptor designado, CK4) NO trae la fase, así que se
   * consulta `conduce_fase` por fila (best-effort, en paralelo). Con la fase real se
   * decide si la entrega está "En camino" (aún sin salir) y el botón de firmar se
   * mantiene apagado hasta que el chofer la entregue. Sin red se omite: la fase queda
   * desconocida → se permite abrir y el servidor rechaza con el mismo texto.
   */
  private async enriquecerFases(filas: EntregaPorRecibir[]): Promise<void> {
    if (!this.network.online()) return;
    const faltantes = filas.filter((f) => !f.fase);
    if (!faltantes.length) return;
    const fases = await Promise.all(
      faltantes.map((f) => this.conduces.conduceFase(f.salidaId).catch(() => null)),
    );
    const mapa = new Map<string, string>();
    faltantes.forEach((f, i) => {
      const fase = fases[i];
      if (fase) mapa.set(f.salidaId, fase);
    });
    if (!mapa.size) return;
    this.entregas.update((lista) => lista.map((e) => (mapa.has(e.salidaId) ? { ...e, fase: mapa.get(e.salidaId)! } : e)));
  }

  /** CM4 — fases en las que el material YA salió / llegó (el receptor puede firmar). */
  private static readonly FASES_ENTREGADAS = new Set([
    'entregando',
    'entregado',
    'entregado_incompleto',
    'pendiente_firma',
    'por_confirmar',
    'confirmado',
    'cerrado',
  ]);

  /**
   * CM4 — ¿la entrega va "En camino" (aún sin entregar)? Solo cuando conocemos una
   * fase y NO es de entregadas. Fase desconocida (offline) = NO en camino: se permite
   * el intento y el servidor es la verdad (Nota #197).
   */
  enCamino(e: EntregaPorRecibir): boolean {
    return !!e.fase && !PorConfirmarPage.FASES_ENTREGADAS.has(e.fase);
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.load(silent);
  }

  get online(): boolean {
    return this.network.online();
  }

  abrir(id: string): void {
    // CM4 — una entrega "En camino" no se abre: el receptor firma al llegar.
    const row = this.entregas().find((e) => e.salidaId === id);
    if (row && this.enCamino(row)) return;
    const abriendo = this.confirmandoId() !== id;
    this.confirmandoId.set(abriendo ? id : '');
    this.foto.set(null);
    this.firmaLista.set(false);
    this.llegoTodo.set(null);
    this.notas.set('');
    this.detalleItems.set([]);
    this.libres.set([]);
    this.cantidades.set({});
    // BR4 — cerrar/limpiar el modo rechazo al cambiar de fila.
    this.modoRechazo.set(false);
    this.motivoRechazo.set('');
    this.fotoRechazo.set(null);
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
    // CO16 — la bandera va en la PRIMERA línea, antes del `await …toBlob()` de la
    // firma (un doble toque mientras se generaba el blob podía confirmar dos veces).
    this.enviando.set(true);
    try {
      const firma = await this.sigPad()?.toBlob();
      if (!firma) {
        this.toast.error(this.i18n.t('Falta tu firma de recepción.'));
        return;
      }
      const foto = this.foto();
      const notas = this.notas().trim();
      // BD2 — foto obligatoria pero NO bloqueante: si no hay foto, se exige una nota.
      if (!foto && !notas) {
        this.toast.error(this.i18n.t('Toma la foto de lo recibido; si no puedes, explica por qué en las notas.'));
        return;
      }
      if (e.fuente === 'confirmar') {
        if (this.llegoTodo() === null) {
          this.toast.error(this.i18n.t('Dinos si llegó todo el material.'));
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
      this.toast.success(this.i18n.t('¡Recepción confirmada! Se avisó al chofer.'));
      // CL2 F4 — momento mediano "entrada" (la caja entra al almacén). Es un aviso
      // local: dispara igual offline (la op ya quedó encolada en el outbox).
      this.motion.momento('entrada');
      this.confirmandoId.set('');
      this.entregas.update((list) => list.filter((x) => x.salidaId !== e.salidaId));
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : this.i18n.t('No se pudo confirmar. Intenta de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ── BR4 — rechazar la entrega ("así como confirmo, debo poder rechazar") ────
  toggleRechazo(): void {
    this.modoRechazo.update((v) => !v);
    if (!this.modoRechazo()) {
      this.motivoRechazo.set('');
      this.fotoRechazo.set(null);
    }
  }

  async rechazar(e: EntregaPorRecibir): Promise<void> {
    if (this.rechazando()) return;
    const motivo = this.motivoRechazo().trim();
    if (!motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo del rechazo (es obligatorio).'));
      return;
    }
    this.rechazando.set(true);
    try {
      // La bandeja del receptor son conduces/salidas; el rechazo va como 'salida'.
      await this.inventario.enqueueRechazarRecepcion({
        tipo: 'salida',
        id: e.salidaId,
        motivo,
        foto: this.fotoRechazo()?.blob ?? null,
      });
      this.toast.success(this.i18n.t('Entrega rechazada. Se le avisó a quien la envió para que la corrija.'));
      this.confirmandoId.set('');
      this.modoRechazo.set(false);
      this.entregas.update((list) => list.filter((x) => x.salidaId !== e.salidaId));
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : this.i18n.t('No se pudo rechazar. Intenta de nuevo.'));
    } finally {
      this.rechazando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
