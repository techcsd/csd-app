import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { TecProveedoresService } from '../../../core/services/tec-proveedores.service';
import { TecProveedorRow } from '../../../core/models/tec-proveedor.model';
import { correoUrl, filtrarProveedoresLocal, telUrl, whatsappUrl } from '../../../core/util/tec-proveedor.util';
import { abrirUrlExterna } from '../../../core/utils/abrir-url.util';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const COINCIDENCIA_LABEL: Record<string, string> = {
  servicio: 'servicio',
  contacto: 'contacto',
  trabajo: 'un trabajo',
  cotizacion: 'una cotización',
  varios: 'varios campos',
};

/**
 * EA1 — Proveedores de Tecnología: buscador único (nombre, servicio, etiqueta,
 * contacto y palabras de trabajos/cotizaciones — «puertas», «cerradura») + contacto
 * con un toque. SOLO LECTURA (DEFAULT EA-09): alta/edición en la web. Con conexión
 * busca en el servidor; sin conexión filtra la última lista guardada.
 */
@Component({
  selector: 'app-proveedores',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
})
export class ProveedoresPage {
  private service = inject(TecProveedoresService);
  private navGuard = inject(NavGuardService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private ctx = inject(UserContextService);

  loading = signal(true);
  error = signal(false);
  fueraDeLinea = signal(false);
  lista = signal<TecProveedorRow[]>([]);
  query = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  puedeVer = computed(() => this.ctx.esTecnologia() || this.ctx.puedeVerSubmodulo('tecnologia.proveedores'));

  get online(): boolean {
    return this.network.online();
  }

  constructor() {
    void this.cargar();
  }

  onQuery(v: string): void {
    this.query.set(v);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.cargar(), 300);
  }

  async cargar(): Promise<void> {
    if (!this.puedeVer()) {
      this.loading.set(false);
      return;
    }
    const mi = ++this.seq;
    this.loading.set(true);
    this.error.set(false);
    this.fueraDeLinea.set(false);
    try {
      if (!this.online) throw new Error('offline');
      const rows = await this.service.buscar(this.query());
      if (mi === this.seq) this.lista.set(rows);
    } catch {
      if (mi !== this.seq) return;
      const cache = await this.service.leerCache();
      if (cache.length) {
        this.fueraDeLinea.set(true);
        this.lista.set(filtrarProveedoresLocal(cache, this.query()));
      } else {
        this.lista.set([]);
        this.error.set(true);
      }
    } finally {
      if (mi === this.seq) this.loading.set(false);
    }
  }

  /** Etiqueta (clave de catálogo) de dónde coincidió la búsqueda. */
  coincideEn(c: string | null): string {
    return COINCIDENCIA_LABEL[c ?? ''] ?? 'varios campos';
  }

  telefono(r: TecProveedorRow): string {
    return telUrl(r.contacto_telefono || r.contacto_whatsapp);
  }
  whatsapp(r: TecProveedorRow): string {
    return whatsappUrl(r.contacto_whatsapp || r.contacto_telefono);
  }
  correo(r: TecProveedorRow): string {
    return correoUrl(r.contacto_correo);
  }

  contactar(ev: Event, url: string): void {
    ev.stopPropagation();
    void abrirUrlExterna(url);
  }

  abrir(r: TecProveedorRow): void {
    void this.router.navigate(['/tecnologia/proveedores', r.id]);
  }

  back(): void {
    this.navGuard.back('/tecnologia');
  }
}
