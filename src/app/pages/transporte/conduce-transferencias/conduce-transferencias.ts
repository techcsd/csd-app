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
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, ConduceTransferencia } from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * AH5 — inbox del receptor de transferencias de conduce. Un chofer que se desliga
 * de un conduce lo OFRECE a otro; aquí el receptor lo revisa y lo ACEPTA con foto
 * + firma (evidencia obligatoria server-side) o lo RECHAZA. Hasta aceptar, la
 * responsabilidad NO cambia. Offline-safe: la aceptación va por outbox.
 */
@Component({
  selector: 'app-conduce-transferencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Skeleton, EmptyState, SyncBar, PhotoSlot, SignaturePad, ConfirmDialog, BigConfirm],
  templateUrl: './conduce-transferencias.html',
  styleUrl: './conduce-transferencias.scss',
})
export class ConduceTransferenciasPage {
  private service = inject(ConducesService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private sig = viewChild<SignaturePad>('firmaPad');

  loading = signal(true);
  ofertas = signal<ConduceTransferencia[]>([]);
  seleccion = signal<ConduceTransferencia | null>(null);
  foto = signal<CapturedPhoto | null>(null);
  firma = signal<Blob | null>(null);
  enviando = signal(false);
  hecho = signal(false);
  confirmRechazo = signal<ConduceTransferencia | null>(null);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.ofertas.set(await this.service.misTransferenciasPendientes());
    } finally {
      this.loading.set(false);
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
      this.toast.error('Toma la foto y firma para aceptar la transferencia.');
      return;
    }
    this.enviando.set(true);
    try {
      await this.service.aceptarTransferencia(t.id, foto, firma);
      this.ofertas.update((l) => l.filter((o) => o.id !== t.id));
      this.seleccion.set(null);
      this.hecho.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo aceptar la transferencia.');
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
      this.toast.success('Transferencia rechazada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo rechazar.');
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
