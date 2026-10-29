import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { NetworkService } from '../../../core/services/network.service';
import { CotizacionesService } from '../../../core/services/cotizaciones.service';
import { CotizacionFiltro, CotizacionRow } from '../../../core/models/cotizacion.model';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFechaMedia } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/**
 * CZ1/CZ2/CZ6 — Biblioteca de Cotizaciones de Tecnología (DZ-25: solo en línea,
 * sin cola offline). Ver/buscar/subir con foto o PDF; ligar a equipos y corregir
 * renglones es trabajo de la web (el mockup lo dice).
 */
@Component({
  selector: 'app-cotizaciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './cotizaciones.html',
  styleUrl: './cotizaciones.scss',
})
export class CotizacionesPage {
  private service = inject(CotizacionesService);
  private navGuard = inject(NavGuardService);
  private network = inject(NetworkService);
  private router = inject(Router);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  lista = signal<CotizacionRow[]>([]);
  query = signal('');
  filtro = signal<CotizacionFiltro>('todas');

  get online(): boolean {
    return this.network.online();
  }

  filtradas = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filtro();
    return this.lista()
      .filter((r) => r.estado !== 'descartada')
      .filter((r) => {
        if (f === 'sin_vincular') return !r.compra_id;
        if (f === 'con_compra') return !!r.compra_id;
        return true;
      })
      .filter((r) => {
        if (!q) return true;
        return (
          (r.proveedor ?? '').toLowerCase().includes(q) ||
          r.titulo.toLowerCase().includes(q) ||
          String(r.total ?? '').includes(q)
        );
      });
  });

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    if (!this.online) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    try {
      this.lista.set(await this.service.listar());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  abrir(r: CotizacionRow): void {
    void this.router.navigate(['/tecnologia/cotizaciones', r.id]);
  }

  subir(): void {
    void this.router.navigate(['/tecnologia/cotizaciones/subir']);
  }

  back(): void {
    this.navGuard.back('/tecnologia');
  }
}
