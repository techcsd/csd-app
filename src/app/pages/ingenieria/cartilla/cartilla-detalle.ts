import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FiguraAcero } from '../../../shared/ui/figura-acero/figura-acero';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { CartillaService } from '../../../core/services/cartilla.service';
import { CartillaPdfService } from '../../../core/services/cartilla-pdf.service';
import { ToastService } from '../../../core/services/toast.service';
import { CartillaDetalle } from '../../../shared/models/cartilla.model';
import { formatFecha } from '../../../core/util/fecha';

/**
 * BO10 — detalle de una cartilla: atados → piezas (figura + tramos + peso), fotos,
 * plano, historial y la observación de oficina. El autor puede "Marcar ejecutada"
 * cuando ya fue revisada. Export PDF para compartir por WhatsApp.
 */
@Component({
  selector: 'app-cartilla-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, FiguraAcero, DecimalPipe, TranslatePipe],
  templateUrl: './cartilla-detalle.html',
  styleUrl: './cartilla-detalle.scss',
})
export class CartillaDetallePage {
  private service = inject(CartillaService);
  private pdf = inject(CartillaPdfService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  private id = this.route.snapshot.paramMap.get('id') ?? '';

  loading = signal(true);
  error = signal(false);
  cartilla = signal<CartillaDetalle | null>(null);
  fotoUrls = signal<string[]>([]);
  planoUrl = signal<string | null>(null);
  marcando = signal(false);
  generandoPdf = signal(false);
  fmtFecha = formatFecha;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const c = await this.service.detalle(this.id);
      this.cartilla.set(c);
      if (c) {
        const urls = await Promise.all((c.fotos ?? []).map((p) => this.service.fotoUrl(p)));
        this.fotoUrls.set(urls.filter((u): u is string => !!u));
        if (c.plano_path) this.planoUrl.set(await this.service.fotoUrl(c.plano_path));
      }
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** El autor marca la cartilla ejecutada (solo tras revisada). */
  puedeMarcarEjecutada(): boolean {
    return this.cartilla()?.estado === 'revisada';
  }

  async marcarEjecutada(): Promise<void> {
    const c = this.cartilla();
    if (!c || this.marcando()) return;
    this.marcando.set(true);
    try {
      await this.service.cambiarEstado(c.id, 'ejecutada');
      this.toast.success(this.i18n.t('Cartilla marcada como ejecutada.'));
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo marcar. Intenta de nuevo.'));
    } finally {
      this.marcando.set(false);
    }
  }

  async descargarPdf(): Promise<void> {
    const c = this.cartilla();
    if (!c || this.generandoPdf()) return;
    this.generandoPdf.set(true);
    try {
      await this.pdf.generar(c);
    } catch {
      this.toast.error(this.i18n.t('No se pudo generar el PDF.'));
    } finally {
      this.generandoPdf.set(false);
    }
  }

  tramosTexto(t: { lado?: string; cm: number }[] | null): string {
    if (!t?.length) return '';
    return t.map((x) => `${x.lado ? x.lado + ':' : ''}${x.cm}`).join(' · ') + ' cm';
  }

  back(): void {
    this.location.back();
  }
}
