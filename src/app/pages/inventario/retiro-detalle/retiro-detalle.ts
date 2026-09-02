import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { RetirosService } from '../../../core/services/retiros.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaMedia } from '../../../core/util/fecha';
import {
  RetiroDetalle,
  RETIRO_ESTADO_LABEL,
  RETIRO_MOTIVO_LABEL,
  retiroCodigo,
} from '../../../core/models/retiro.model';

/**
 * BG4 — detalle de un retiro: estado, artículos, fotos del daño, y —si aún es
 * cancelable y es suyo— cancelar con motivo. Cache-then-network (offline-safe).
 */
@Component({
  selector: 'app-retiro-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton],
  templateUrl: './retiro-detalle.html',
  styleUrl: './retiro-detalle.scss',
})
export class RetiroDetallePage {
  private route = inject(ActivatedRoute);
  private retiros = inject(RetirosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private id = this.route.snapshot.paramMap.get('id') ?? '';

  detalle = signal<RetiroDetalle | null>(null);
  fotoUrls = signal<string[]>([]);
  loading = signal(true);
  online = this.network.online;
  fmt = formatFechaMedia;
  codigo = retiroCodigo;
  estadoLabel = RETIRO_ESTADO_LABEL;
  motivoLabel = RETIRO_MOTIVO_LABEL;

  fotoAbierta = signal<string | null>(null);
  confirmarCancelar = signal(false);
  motivoCancelar = signal('');
  cancelando = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const d = await this.retiros.detalle(this.id);
      this.detalle.set(d);
      // Fotos: URLs firmadas (online). Offline se ven al reconectar.
      const paths = d?.fotos?.map((f) => f.path) ?? [];
      const urls = await Promise.all(paths.map((p) => this.retiros.fotoUrl(p)));
      this.fotoUrls.set(urls.filter((u): u is string => !!u));
    } finally {
      this.loading.set(false);
    }
  }

  puedeCancelar(): boolean {
    const e = this.detalle()?.retiro.estado;
    return e === 'pendiente' || e === 'aprobada';
  }

  abrirFoto(url: string): void {
    this.fotoAbierta.set(url);
  }
  cerrarFoto(): void {
    this.fotoAbierta.set(null);
  }

  pedirCancelar(): void {
    this.motivoCancelar.set('');
    this.confirmarCancelar.set(true);
  }
  async confirmarCancelacion(): Promise<void> {
    const motivo = this.motivoCancelar().trim();
    if (!motivo) {
      this.toast.error('Escribe el motivo de la cancelación.');
      return;
    }
    if (!this.online()) {
      this.toast.error('Necesitas conexión para cancelar.');
      return;
    }
    this.cancelando.set(true);
    try {
      await this.retiros.cancelar(this.id, motivo);
      this.confirmarCancelar.set(false);
      this.toast.success('Retiro cancelado.');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cancelar.');
    } finally {
      this.cancelando.set(false);
    }
  }
  cancelarCancelacion(): void {
    this.confirmarCancelar.set(false);
  }

  back(): void {
    this.location.back();
  }
}
