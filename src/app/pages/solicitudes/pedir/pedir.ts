import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SelectorCategorias } from '../../../shared/ui/selector-categorias/selector-categorias';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { Proyecto } from '../../../core/models/bitacora.model';
import { ArticuloCat, CartLinea, CategoriaInv, Urgencia } from '../../../core/models/inventario.model';
import { compartirTexto } from '../../../core/util/share';

interface GrupoResumen {
  categoria: string;
  lineas: CartLinea[];
}

/**
 * V13 — Requisición por el patrón de HOJAS: selección por categorías (con "Otros"
 * libre) → resumen editable (obra + urgencia) → éxito con compartir por WhatsApp.
 * Reusa SelectorCategorias en modo 'requisicion' y commitea vía crear_solicitud_app.
 */
@Component({
  selector: 'app-pedir',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectorCategorias, SelectList, ConfirmDialog, WizardFooter],
  templateUrl: './pedir.html',
  styleUrl: '../../inventario/salida/salida.scss',
})
export class PedirPage implements OnDestroy {
  private solicitudes = inject(SolicitudesService);
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);

  hoja = signal<'seleccion' | 'resumen' | 'exito'>('seleccion');

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  loadingCat = signal(true);
  cart = signal<CartLinea[]>([]);
  urgencia = signal<Urgencia>('normal');
  notas = signal('');
  submitting = signal(false);
  confirmSalir = signal(false);
  sharing = signal(false);

  obraOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));

  grupos = computed<GrupoResumen[]>(() => {
    const nombre = new Map(this.categorias().map((c) => [c.id, c.nombre]));
    const byCat = new Map<string, CartLinea[]>();
    for (const l of this.cart()) {
      const key = l.categoria_id != null ? nombre.get(l.categoria_id) ?? 'Otros' : 'Sin categoría';
      const arr = byCat.get(key) ?? [];
      arr.push(l);
      byCat.set(key, arr);
    }
    return [...byCat.entries()].map(([categoria, lineas]) => ({ categoria, lineas }));
  });

  totalItems = computed(() => this.cart().length);

  private readonly backHandler = (): boolean => {
    if (this.cart().length > 0) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.init();
    this.navGuard.register(this.backHandler);
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loadingCat.set(true);
    try {
      const [p, a, cat] = await Promise.all([
        this.solicitudes.getProyectos(),
        this.inventario.getArticulos(),
        this.inventario.getCategorias(),
      ]);
      this.proyectos.set(p);
      this.articulos.set(a);
      this.categorias.set(cat);
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (p.length === 1) this.proyectoId.set(p[0].id);
    } finally {
      this.loadingCat.set(false);
    }
  }

  // ── Navegación entre hojas ──
  irResumen(): void {
    this.hoja.set('resumen');
  }
  volverSeleccion(): void {
    this.hoja.set('seleccion');
  }
  intentarSalir(): void {
    if (this.cart().length > 0) this.confirmSalir.set(true);
    else this.finish();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.finish();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  // ── Edición en el resumen ──
  ajustar(articuloId: string, delta: number): void {
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.max(0, l.cantidad + delta) } : l))
        .filter((l) => l.cantidad > 0),
    );
  }
  setCantidad(articuloId: string, v: number): void {
    const cant = Math.max(0, v || 0);
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l))
        .filter((l) => l.cantidad > 0),
    );
  }
  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
    if (!this.cart().length) this.hoja.set('seleccion');
  }

  get online(): boolean {
    return this.network.online();
  }

  private descripcionDe(l: CartLinea): string {
    const base = l.descripcion?.trim() || l.nombre;
    return l.talla ? `${base} (Talla ${l.talla})` : base;
  }

  private esCustom(l: CartLinea): boolean {
    return typeof l.articulo_id === 'string' && l.articulo_id.startsWith('otro:');
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    const items = this.cart().filter((l) => l.cantidad > 0);
    if (!items.length) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.solicitudes.enqueueSolicitud({
        proyectoId: this.proyectoId(),
        urgencia: this.urgencia(),
        notas: this.notas().trim() || null,
        items: items.map((l) => ({
          articulo_id: this.esCustom(l) ? null : l.articulo_id,
          descripcion: this.descripcionDe(l),
          cantidad: l.cantidad,
          unidad: l.unidad,
        })),
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.submitting.set(false);
    }
  }

  // ── Compartir ──
  private resumenTexto(): string {
    const obra = this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '—';
    const fecha = new Date().toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
    const urg = this.urgencia() === 'urgente' ? '🔴 URGENTE' : 'Normal';
    const lineas = this.grupos()
      .map(
        (g) =>
          `*${g.categoria}*\n` +
          g.lineas.map((l) => `  • ${this.descripcionDe(l)}: ${l.cantidad} ${l.unidad}`).join('\n'),
      )
      .join('\n');
    const notas = this.notas().trim() ? `\nNota: ${this.notas().trim()}` : '';
    return `📝 *Requisición de material — CSD*\nObra: ${obra}\nUrgencia: ${urg}\nFecha: ${fecha}${notas}\n\n${lineas}\n\nTotal: ${this.totalItems()} artículo(s)`;
  }

  async compartir(): Promise<void> {
    if (this.sharing()) return;
    this.sharing.set(true);
    try {
      const res = await compartirTexto('Requisición de material', this.resumenTexto());
      if (res.fallback) this.toast.success('Resumen copiado. Pégalo en WhatsApp.');
    } catch {
      this.toast.error('No se pudo compartir.');
    } finally {
      this.sharing.set(false);
    }
  }

  nuevoRegistro(): void {
    this.cart.set([]);
    this.notas.set('');
    this.urgencia.set('normal');
    this.hoja.set('seleccion');
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/solicitudes'], { replaceUrl: true });
  }
}
