import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, ConduceTransferencia, ConduceTransferenciaOfrecida } from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

type Tab = 'aceptar' | 'ofrecidas';

/**
 * AH5 — inbox del receptor de transferencias de conduce. Un chofer que se desliga
 * de un conduce lo OFRECE a otro; aquí el receptor lo revisa y lo ACEPTA con foto
 * + firma (evidencia obligatoria server-side) o lo RECHAZA. Hasta aceptar, la
 * responsabilidad NO cambia. Offline-safe: la aceptación va por outbox.
 *
 * DE4 — además "Ofrecidas por mí" (las que YO ofrecí, con su estado y Cancelar) y
 * empty-vs-failed (BL2): un error de red ya NO se ve igual que "no tienes nada" —
 * el receptor tiene forma de saber que debe reintentar en vez de asumir que nadie
 * le transfirió nada.
 */
@Component({
  selector: 'app-conduce-transferencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    Skeleton,
    EmptyState,
    SyncBar,
    PhotoSlot,
    SignaturePad,
    ConfirmDialog,
    BigConfirm,
    LiveRefreshDirective,
    TranslatePipe,
  ],
  templateUrl: './conduce-transferencias.html',
  styleUrl: './conduce-transferencias.scss',
})
export class ConduceTransferenciasPage {
  private service = inject(ConducesService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private i18n = inject(I18nService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);

  private sig = viewChild<SignaturePad>('firmaPad');

  /** DE4/A2.5 — las transferencias solo llegan a choferes de flota (a_conductor_id
   *  vive en `sgc.conductores`); quien no lo es nunca verá nada aquí aunque alguien
   *  "le" ofrezca algo por error de selección. Mensaje explícito en vez de un
   *  "Sin transferencias" que parece un simple vacío. */
  esChofer = this.ctx.esChoferFlota;

  tab = signal<Tab>('aceptar');

  loading = signal(true);
  refrescando = signal(false);
  ofertas = signal<ConduceTransferencia[]>([]);
  fallo = signal(false);

  loadingOfrecidas = signal(true);
  refrescandoOfrecidas = signal(false);
  ofrecidas = signal<ConduceTransferenciaOfrecida[]>([]);
  falloOfrecidas = signal(false);
  cargadasOfrecidas = false;

  seleccion = signal<ConduceTransferencia | null>(null);
  foto = signal<CapturedPhoto | null>(null);
  firma = signal<Blob | null>(null);
  enviando = signal(false);
  hecho = signal(false);
  confirmRechazo = signal<ConduceTransferencia | null>(null);
  confirmCancelar = signal<ConduceTransferenciaOfrecida | null>(null);
  cancelando = signal(false);

  constructor() {
    void this.cargar();
  }

  irA(t: Tab): void {
    this.tab.set(t);
    if (t === 'ofrecidas' && !this.cargadasOfrecidas) void this.cargarOfrecidas();
  }

  /** AM2 — recarga homologada (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.cargar(silent);
    if (this.cargadasOfrecidas) void this.cargarOfrecidas(silent);
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      const r = await this.service.misTransferenciasPendientesDetailed();
      this.ofertas.set(r.items);
      this.fallo.set(r.failed && !r.fromCache);
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  async cargarOfrecidas(silent = false): Promise<void> {
    if (!silent) this.loadingOfrecidas.set(true);
    this.refrescandoOfrecidas.set(true);
    try {
      const r = await this.service.misTransferenciasOfrecidasDetailed();
      this.ofrecidas.set(r.items);
      this.falloOfrecidas.set(r.failed && !r.fromCache);
      this.cargadasOfrecidas = true;
    } finally {
      this.loadingOfrecidas.set(false);
      this.refrescandoOfrecidas.set(false);
    }
  }

  pedirCancelar(t: ConduceTransferenciaOfrecida): void {
    this.confirmCancelar.set(t);
  }
  cancelarCancelacion(): void {
    this.confirmCancelar.set(null);
  }
  async confirmarCancelar(): Promise<void> {
    const t = this.confirmCancelar();
    this.confirmCancelar.set(null);
    if (!t) return;
    // DE4/A2.6 — cancelar, como ofrecer, exige conexión (coordina a dos personas;
    // mensaje claro en vez de un fallo silencioso de red).
    if (!this.network.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para cancelar la transferencia.'));
      return;
    }
    this.cancelando.set(true);
    try {
      await this.service.cancelarTransferenciaOfrecida(t.id);
      this.ofrecidas.update((l) => l.filter((o) => o.id !== t.id));
      this.toast.success(this.i18n.t('Transferencia cancelada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cancelar la transferencia.'));
    } finally {
      this.cancelando.set(false);
    }
  }

  abrir(t: ConduceTransferencia): void {
    this.seleccion.set(t);
    this.foto.set(null);
    this.firma.set(null);
  }
  cerrar(): void {
    this.seleccion.set(null);
  }

  async onFirma(has: boolean): Promise<void> {
    this.firma.set(has ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  puedeAceptar(): boolean {
    return !!(this.foto() && this.firma()) && !this.enviando();
  }

  async aceptar(): Promise<void> {
    const t = this.seleccion();
    if (!t || !this.puedeAceptar()) return;
    const foto = this.foto()?.blob;
    const firma = this.firma();
    if (!foto || !firma) {
      this.toast.error(this.i18n.t('Toma la foto y firma para aceptar la transferencia.'));
      return;
    }
    this.enviando.set(true);
    try {
      await this.service.aceptarTransferencia(t.id, foto, firma);
      this.ofertas.update((l) => l.filter((o) => o.id !== t.id));
      this.seleccion.set(null);
      this.hecho.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo aceptar la transferencia.'));
    } finally {
      this.enviando.set(false);
    }
  }

  pedirRechazo(t: ConduceTransferencia): void {
    this.confirmRechazo.set(t);
  }
  async confirmarRechazo(): Promise<void> {
    const t = this.confirmRechazo();
    this.confirmRechazo.set(null);
    if (!t) return;
    try {
      await this.service.rechazarTransferencia(t.id, null);
      this.ofertas.update((l) => l.filter((o) => o.id !== t.id));
      this.seleccion.set(null);
      this.toast.success(this.i18n.t('Transferencia rechazada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo rechazar.'));
    }
  }
  cancelarRechazo(): void {
    this.confirmRechazo.set(null);
  }

  finish(): void {
    this.hecho.set(false);
  }

  back(): void {
    this.location.back();
  }
}
