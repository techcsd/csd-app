import { ChangeDetectionStrategy, Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { InventarioService, FirmaPendiente } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { SyncService } from '../../../core/sync/sync.service';
import { traducir } from '../../../core/util/dominio-labels';

/**
 * AE — Bandeja "Por firmar": entregas (devoluciones/conduces) cuya firma de RECEPTOR
 * quedó pendiente asignada a mí. El responsable entra, firma, y se completa. Es el
 * destino del aviso dirigido que se manda al registrar con firma pendiente.
 */
@Component({
  selector: 'app-por-firmar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, SignaturePad],
  templateUrl: './por-firmar.html',
  styleUrl: './por-firmar.scss',
})
export class PorFirmarPage {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private sync = inject(SyncService);

  private sig = viewChild<SignaturePad>('pad');

  loading = signal(true);
  pendientes = signal<FirmaPendiente[]>([]);
  firmando = signal<FirmaPendiente | null>(null);
  nombre = signal('');
  guardando = signal(false);
  private primerSync = true;

  /** AU15 — "Motivo" legible (nunca el valor crudo `uso_proyecto`). */
  motivoLabel(m: string | null | undefined): string {
    return traducir('conduce_motivo', m) || 'Entrega de material';
  }

  constructor() {
    void this.load();
    // Refresca al drenar el outbox (una firma enviada desaparece de la lista). Solo
    // con el outbox drenado: si aún hay ops pendientes, recargar traería del servidor
    // la firma que acabo de enviar (aún sin procesar) y "reaparecería".
    effect(() => {
      this.sync.changed();
      const pend = this.sync.pendingCount();
      if (this.primerSync) {
        this.primerSync = false;
        return;
      }
      if (pend === 0) void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.pendientes.set(await this.inventario.misFirmasPendientes());
    } finally {
      this.loading.set(false);
    }
  }

  abrirFirmar(item: FirmaPendiente): void {
    this.nombre.set(this.ctx.nombre() || '');
    this.firmando.set(item);
  }
  cerrarFirmar(): void {
    this.firmando.set(null);
  }

  async confirmarFirma(): Promise<void> {
    const item = this.firmando();
    if (!item || this.guardando()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe tu nombre.');
      return;
    }
    const blob = await this.sig()?.toBlob();
    if (!blob) {
      this.toast.error('Falta tu firma.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.inventario.enqueueFirmarReceptor(item.salida_id, this.nombre().trim(), blob);
      this.pendientes.update((list) => list.filter((x) => x.salida_id !== item.salida_id));
      this.firmando.set(null);
      this.toast.success('Firma registrada. Se sincroniza al reconectar.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo firmar.');
    } finally {
      this.guardando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
