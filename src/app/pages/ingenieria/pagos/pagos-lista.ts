import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PagosObraService } from '../../../core/services/pagos-obra.service';
import { ProyectosService, ProyectoPickable } from '../../../core/services/proyectos.service';
import { PagoObra } from '../../../core/models/pagos-obra.model';
import { formatFecha, fechaLocalISO } from '../../../core/util/fecha';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** `YYYY-MM-DD` del lunes de la semana de `d` (lunes=inicio, como la nómina). */
function lunesDe(d: Date): string {
  const day = d.getDay(); // 0=domingo..6=sábado
  const diff = day === 0 ? -6 : 1 - day;
  const l = new Date(d);
  l.setDate(d.getDate() + diff);
  return fechaLocalISO(l);
}

/** Suma `dias` a una fecha `YYYY-MM-DD` (sin corrimiento UTC). */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + dias);
  return fechaLocalISO(dt);
}

/**
 * A4 — bandeja de "Pagos": semanas de pago de personal de las obras del
 * ingeniero (RLS ya acota). Crear semana es operar-only; ver es también para
 * abogado/gerencia/dirección (solo lectura, gate real vive en el detalle).
 */
@Component({
  selector: 'app-pagos-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './pagos-lista.html',
  styleUrl: './pagos-lista.scss',
})
export class PagosListaPage {
  private service = inject(PagosObraService);
  private proyectos = inject(ProyectosService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);

  /** CP1/AW12 — glifos desde TS (guarda no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyphPagos = '🧾';
  readonly glyphObra = '🏗';
  readonly glyphOffline = '📡';
  readonly glyphNuevo = '➕';

  readonly online = this.network.online;
  readonly fmt = formatFecha;

  /** Operar = crear semanas / editar / firmar / enviar. Ver = solo lectura (abogado/gerencia/dirección). */
  readonly puedeOperar = computed(() => this.ctx.esAdmin() || this.ctx.puedeOperarSubmodulo('ingenieria.pagos'));

  loading = signal(true);
  error = signal(false);
  pagos = signal<PagoObra[]>([]);
  obras = signal<ProyectoPickable[]>([]);

  mostrarCrear = signal(false);
  nuevoObraId = signal('');
  nuevoDesde = signal(lunesDe(new Date()));
  nuevoHasta = computed(() => sumarDias(this.nuevoDesde(), 6));
  creando = signal(false);

  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));

  constructor() {
    void this.cargar();
  }

  nombreObra(proyectoId: string): string {
    return this.obras().find((o) => o.id === proyectoId)?.nombre ?? this.i18n.t('Obra');
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const [pagos, obras] = await Promise.all([
        this.service.listar(),
        this.proyectos.getProyectosPickables().catch(() => [] as ProyectoPickable[]),
      ]);
      this.pagos.set(pagos);
      this.obras.set(obras);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  abrirCrear(): void {
    this.nuevoObraId.set(this.obras()[0]?.id ?? '');
    this.nuevoDesde.set(lunesDe(new Date()));
    this.mostrarCrear.set(true);
  }

  cerrarCrear(): void {
    this.mostrarCrear.set(false);
  }

  elegirObraNueva(id: string): void {
    this.nuevoObraId.set(id);
  }

  async crearSemana(): Promise<void> {
    if (this.creando()) return;
    if (!this.nuevoObraId()) {
      this.toast.error(this.i18n.t('Elige una obra.'));
      return;
    }
    if (!this.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para crear una semana de pago.'));
      return;
    }
    this.creando.set(true);
    try {
      const id = await this.service.crear(this.nuevoObraId(), this.nuevoDesde(), this.nuevoHasta());
      this.mostrarCrear.set(false);
      await this.router.navigate(['/ingenieria/pagos', id]);
    } catch (e) {
      this.toast.error(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo crear la semana de pago.'));
    } finally {
      this.creando.set(false);
    }
  }

  abrir(p: PagoObra): void {
    void this.router.navigate(['/ingenieria/pagos', p.id]);
  }

  back(): void {
    this.location.back();
  }
}
