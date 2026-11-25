import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavGuardService } from '../../../../core/services/nav-guard.service';
import { NetworkService } from '../../../../core/services/network.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { UserContextService } from '../../../../core/services/user-context.service';
import { TecProveedoresService } from '../../../../core/services/tec-proveedores.service';
import {
  TecProveedorContacto,
  TecProveedorDetalle,
  TecProveedorFactura,
  TecProveedorTab,
} from '../../../../core/models/tec-proveedor.model';
import { correoUrl, telUrl, whatsappUrl } from '../../../../core/util/tec-proveedor.util';
import { abrirUrlExterna } from '../../../../core/utils/abrir-url.util';
import { formatFechaMedia } from '../../../../core/util/fecha';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';

const ESTADO_LABEL: Record<string, string> = {
  cotizado: 'Cotizado',
  en_curso: 'En curso',
  completado: 'Completado',
  cancelado: 'Cancelado',
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  anulada: 'Anulada',
};

/**
 * EA1 — ficha de un proveedor de Tecnología: Resumen · Contactos · Trabajos · Facturas.
 * Solo lectura; botones Llamar / WhatsApp / Correo por contacto. Edición = web.
 */
@Component({
  selector: 'app-proveedor-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './proveedor-detalle.html',
  styleUrl: '../proveedores.scss',
})
export class ProveedorDetallePage {
  private service = inject(TecProveedoresService);
  private navGuard = inject(NavGuardService);
  private network = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private ctx = inject(UserContextService);

  fmtFecha = formatFechaMedia;

  /** Etiqueta (clave de catálogo) de un estado de trabajo/factura. */
  estadoLabel(e: string): string {
    return ESTADO_LABEL[e] ?? e;
  }

  loading = signal(true);
  detalle = signal<TecProveedorDetalle | null>(null);
  tab = signal<TecProveedorTab>('resumen');
  readonly tabs: { id: TecProveedorTab; label: string }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'contactos', label: 'Contactos' },
    { id: 'trabajos', label: 'Trabajos' },
    { id: 'facturas', label: 'Facturas' },
  ];

  puedeOperar = computed(() => this.ctx.puedeOperarSubmodulo('tecnologia.proveedores'));

  get online(): boolean {
    return this.network.online();
  }

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      this.detalle.set(this.online && id ? await this.service.detalle(id) : null);
    } catch {
      this.detalle.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  tel(c: TecProveedorContacto): string {
    return telUrl(c.telefono || c.whatsapp);
  }
  wa(c: TecProveedorContacto): string {
    return whatsappUrl(c.whatsapp || c.telefono);
  }
  mail(c: TecProveedorContacto): string {
    return correoUrl(c.correo);
  }
  abrir(url: string): void {
    void abrirUrlExterna(url);
  }

  webUrl(w: string | null): string {
    const v = (w ?? '').trim();
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }

  async verFactura(f: TecProveedorFactura): Promise<void> {
    if (!f.archivo_path) return;
    const url = await this.service.urlArchivo(f.archivo_path);
    if (url) void abrirUrlExterna(url);
    else this.toast.error(this.i18n.t('No se pudo abrir el archivo'));
  }

  back(): void {
    this.navGuard.back('/tecnologia/proveedores');
  }
}
