import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { QtyInput } from '../../../shared/ui/qty-input/qty-input';
import { SolicitudesCompraService } from '../../../core/services/solicitudes-compra.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { Proyecto } from '../../../core/models/bitacora.model';
import {
  MiSolicitudCompra,
  SolicitudCompraItem,
  SOLICITUD_COMPRA_ESTADO_META,
} from '../../../core/models/solicitud-compra.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** Un renglón en edición en el formulario. */
interface DraftItem {
  key: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  proveedor: string;
}

/**
 * BH8 — Solicitud de compra a mano (Compras / Raykler). La pantalla que existía en
 * la web bajo bitácora, ahora en la app donde vive quien la necesita. Offline por
 * outbox (idempotente). "Mis solicitudes" muestra estado + procedencia (BH7).
 */
@Component({
  selector: 'app-solicitud-compra',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, QtyInput],
  templateUrl: './solicitud-compra.html',
  styleUrl: './solicitud-compra.scss',
})
export class SolicitudCompraPage {
  private service = inject(SolicitudesCompraService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly fmtFecha = formatFechaMedia;
  readonly estadoMeta = SOLICITUD_COMPRA_ESTADO_META;
  readonly codigoReq = (folio: number | null): string =>
    folio == null ? '' : `REQ-${String(folio).padStart(6, '0')}`;

  hoja = signal<'lista' | 'crear'>('lista');
  loading = signal(true);
  error = signal(false);
  lista = signal<MiSolicitudCompra[]>([]);

  // ── Formulario ──
  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal('');
  categoria = signal('');
  notas = signal('');
  items = signal<DraftItem[]>([this.nuevoItem()]);
  enviando = signal(false);

  proyectoOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));

  constructor() {
    void this.load();
  }

  private nuevoItem(): DraftItem {
    return { key: crypto.randomUUID(), descripcion: '', cantidad: 1, unidad: 'UND', proveedor: '' };
  }

  get online(): boolean {
    return this.net.online();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.lista.set(await this.service.misSolicitudes());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  abrirCrear(): void {
    this.hoja.set('crear');
    if (!this.proyectos().length) {
      this.service.getProyectos().then((p) => this.proyectos.set(p)).catch(() => {});
    }
  }

  cerrarCrear(): void {
    this.hoja.set('lista');
    this.proyectoId.set('');
    this.categoria.set('');
    this.notas.set('');
    this.items.set([this.nuevoItem()]);
  }

  setCantidad(key: string, v: number): void {
    this.items.update((l) => l.map((it) => (it.key === key ? { ...it, cantidad: Math.max(0, v || 0) } : it)));
  }
  setDescripcion(key: string, v: string): void {
    this.items.update((l) => l.map((it) => (it.key === key ? { ...it, descripcion: v } : it)));
  }
  setUnidad(key: string, v: string): void {
    this.items.update((l) => l.map((it) => (it.key === key ? { ...it, unidad: v } : it)));
  }
  setProveedor(key: string, v: string): void {
    this.items.update((l) => l.map((it) => (it.key === key ? { ...it, proveedor: v } : it)));
  }
  agregarItem(): void {
    this.items.update((l) => [...l, this.nuevoItem()]);
  }
  quitarItem(key: string): void {
    this.items.update((l) => (l.length > 1 ? l.filter((it) => it.key !== key) : l));
  }

  async enviar(): Promise<void> {
    if (this.enviando()) return;
    const items: SolicitudCompraItem[] = this.items()
      .filter((it) => it.descripcion.trim() && it.cantidad > 0)
      .map((it) => ({
        descripcion: it.descripcion.trim(),
        cantidad: it.cantidad,
        unidad: it.unidad.trim() || null,
        proveedor_sugerido: it.proveedor.trim() || null,
      }));
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra para la que se compra.');
      return;
    }
    if (!items.length) {
      this.toast.error('Agrega al menos un renglón con descripción y cantidad.');
      return;
    }
    this.enviando.set(true);
    try {
      await this.service.enqueue({
        proyectoId: this.proyectoId(),
        notas: this.notas().trim() || null,
        categoria: this.categoria().trim() || null,
        items,
      });
      // Offline-first: se encoló; si hay red, sincroniza sola. Mensaje honesto.
      this.toast.success(this.online ? 'Solicitud de compra enviada.' : 'Guardada. Se enviará al recuperar señal.');
      this.cerrarCrear();
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la solicitud.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    if (this.hoja() === 'crear') {
      this.cerrarCrear();
      return;
    }
    this.location.back();
  }
}
