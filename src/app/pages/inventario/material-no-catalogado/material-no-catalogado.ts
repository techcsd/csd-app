import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { MaterialNoCatalogado, ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

type Modo = 'declinar' | 'vincular' | 'crear';

/**
 * AU4 — bandeja de material NO catalogado (regla AT11 — todo item libre es visible
 * para depurar el catálogo). El RPC gatea por admin/inventario (a otros roles
 * devuelve []). BW2 — para elevados de flota / inventario la app ya no solo declina:
 * puede **vincular** el material a un artículo del catálogo o **crear** el artículo
 * (crea + vincula atómico), con la opción de generar el movimiento de inventario
 * retroactivo (AY13). Ambas acciones van por el outbox (offline-safe) y usan los
 * RPCs del padre `vincular_item_libre_articulo` / `crear_articulo_desde_libre`.
 */
@Component({
  selector: 'app-material-no-catalogado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, LiveRefreshDirective, ArticuloPicker, TranslatePipe],
  templateUrl: './material-no-catalogado.html',
  styleUrl: './material-no-catalogado.scss',
})
export class MaterialNoCatalogadoPage {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  fmtFecha = formatFecha;

  loading = signal(true);
  refrescando = signal(false);
  incluirResueltos = signal(false);
  items = signal<MaterialNoCatalogado[]>([]);

  // BW2 — ¿puede vincular/crear? (mismo gate que el RPC: elevado de flota o inventario).
  puedeGestionar = computed(() => this.ctx.esFlotaElevado() || this.ctx.hasModulo('inventario'));

  // Acción abierta: item + modo (declinar / vincular / crear). Solo una a la vez.
  accionId = signal<string | null>(null);
  modo = signal<Modo | null>(null);
  enviando = signal(false);

  // AT11 — declinar.
  readonly motivos = [
    'No es necesario crear el artículo',
    'Ya existe en el catálogo',
    'Duplicado',
  ];

  // BW2 — vincular: artículo elegido (controlado en el botón) + movimiento retroactivo.
  vinSel = signal<ArticuloCat | null>(null);
  // BW2 — crear: nombre (prellenado), categoría, unidad + movimiento retroactivo.
  crNombre = signal('');
  crCategoriaId = signal<number | null>(null);
  crUnidad = signal('');
  genMov = signal(false);
  categorias = signal<CategoriaInv[]>([]);

  // Buscador server-side (alias-aware) para el picker de vincular.
  buscador = (q: string) => this.inventario.buscarArticulos(q).then((r) => r as ArticuloCat[]);

  constructor() {
    void this.load();
  }

  // ── Apertura/cierre de las acciones por item ────────────────────────────────
  toggleDeclinar(id: string): void {
    this.abrir(id, 'declinar');
  }

  abrirVincular(item: MaterialNoCatalogado): void {
    if (this.accionId() === item.id && this.modo() === 'vincular') return this.cerrar();
    this.vinSel.set(null);
    this.genMov.set(false);
    this.abrir(item.id, 'vincular');
  }

  async abrirCrear(item: MaterialNoCatalogado): Promise<void> {
    if (this.accionId() === item.id && this.modo() === 'crear') return this.cerrar();
    this.crNombre.set(item.nombre);
    this.crCategoriaId.set(null);
    this.crUnidad.set(item.unidad ?? '');
    this.genMov.set(false);
    this.abrir(item.id, 'crear');
    if (!this.categorias().length) {
      try {
        this.categorias.set(await this.inventario.getCategorias());
      } catch {
        /* sin red: se puede escribir la unidad, pero la categoría requiere el catálogo */
      }
    }
  }

  private abrir(id: string, modo: Modo): void {
    this.accionId.set(id);
    this.modo.set(modo);
  }

  private cerrar(): void {
    this.accionId.set(null);
    this.modo.set(null);
  }

  esAccion(id: string, modo: Modo): boolean {
    return this.accionId() === id && this.modo() === modo;
  }

  // ── AT11 — declinar ─────────────────────────────────────────────────────────
  async declinar(item: MaterialNoCatalogado, motivo: string): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.inventario.declinarItemLibre(item.id, motivo);
      this.toast.success(this.i18n.t('Material declinado. Se avisó a quien lo reportó.'));
      this.cerrar();
      await this.load(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo declinar.'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ── BW2 — vincular a un artículo existente ──────────────────────────────────
  onVincularPick(a: ArticuloCat): void {
    this.vinSel.set(a);
  }

  async confirmarVincular(item: MaterialNoCatalogado): Promise<void> {
    const art = this.vinSel();
    if (!art || this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.inventario.enqueueVincularItemLibre(item.id, art.id, this.genMov());
      this.toast.success(this.i18n.t('Se vinculó a {art}.', { art: art.nombre }));
      this.quitarItem(item.id);
      this.cerrar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo vincular.'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ── BW2 — crear el artículo desde el material ───────────────────────────────
  async confirmarCrear(item: MaterialNoCatalogado): Promise<void> {
    if (this.enviando()) return;
    const nombre = this.crNombre().trim();
    const catId = this.crCategoriaId();
    if (!nombre) {
      this.toast.error(this.i18n.t('Escribe el nombre del artículo.'));
      return;
    }
    if (catId == null) {
      this.toast.error(this.i18n.t('Elige una categoría.'));
      return;
    }
    this.enviando.set(true);
    try {
      await this.inventario.enqueueCrearArticuloLibre(item.id, nombre, catId, this.crUnidad().trim() || null, this.genMov());
      this.toast.success(this.i18n.t('Artículo creado y vinculado.'));
      this.quitarItem(item.id);
      this.cerrar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo crear el artículo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  /** Quita el item de la lista al encolar la acción (optimista; el read-through
   *  refleja la verdad en el próximo refresco). */
  private quitarItem(id: string): void {
    this.items.update((list) => list.filter((m) => m.id !== id));
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.items.set(await this.inventario.materialNoCatalogadoPendientes(this.incluirResueltos()));
    } catch {
      this.toast.error(this.i18n.t('No pudimos cargar los materiales no catalogados.'));
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  toggleResueltos(): void {
    this.incluirResueltos.update((v) => !v);
    this.cerrar();
    void this.load();
  }

  back(): void {
    this.navGuard.back('/home');
  }
}
