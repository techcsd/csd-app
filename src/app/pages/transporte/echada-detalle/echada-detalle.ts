import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CombustibleService } from '../../../core/services/combustible.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { EchadaDetalle, PRODUCTO_CANONICO_LABEL, productoCanonico } from '../../../core/models/combustible.model';
import { formatFechaHumana } from '../../../core/util/fecha';

/**
 * AQ13/AQ6 — Detalle de una echada (registro de combustible). Se abre desde el
 * Registro de echadas (fila clickable) y desde el deep-link de la notificación de
 * "consumo anormal". Muestra vehículo, km + delta, galones, monto, tipo, quién
 * registró, chofer, fotos (lightbox) y el flag de consumo anormal con su motivo.
 */
@Component({
  selector: 'app-echada-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState],
  templateUrl: './echada-detalle.html',
  styleUrl: './echada-detalle.scss',
})
export class EchadaDetallePage {
  private combustible = inject(CombustibleService);
  private route = inject(ActivatedRoute);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  fmtFechaHora = formatFechaHumana;

  id = this.route.snapshot.paramMap.get('id') ?? '';
  loading = signal(true);
  echada = signal<EchadaDetalle | null>(null);
  lightboxUrl = signal<string | null>(null);

  sospechosa = computed(() => {
    const e = this.echada();
    return !!e && (e.alerta_consumo || e.km_alerta);
  });
  tipoLabel = computed(() => {
    const e = this.echada();
    if (!e) return '';
    const canon = productoCanonico(e.producto, e.subtipo);
    return (canon && PRODUCTO_CANONICO_LABEL[canon]) || [e.producto, e.subtipo].filter(Boolean).join(' · ') || '—';
  });
  fotos = computed(() => {
    const e = this.echada();
    if (!e) return [] as { label: string; url: string }[];
    return [
      { label: 'Recibo', url: e.foto_recibo_url },
      { label: 'Tablero', url: e.foto_tablero_url },
      { label: 'Bomba', url: e.foto_bomba_url },
    ].filter((f): f is { label: string; url: string } => !!f.url);
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      this.echada.set(await this.combustible.getEchadaDetalle(this.id));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar la echada.');
    } finally {
      this.loading.set(false);
    }
  }

  verFoto(url: string): void {
    this.lightboxUrl.set(url);
  }
  cerrarLightbox(): void {
    this.lightboxUrl.set(null);
  }

  back(): void {
    this.navGuard.back('/transporte/combustible-log');
  }
}
