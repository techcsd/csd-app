import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ArticuloCat, Bodega, CategoriaInv, Existencia } from '../../../core/models/inventario.model';

/** CC1 — normaliza texto para búsqueda sin acentos ni mayúsculas (NFD + strip). */
function norm(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Y9 — un grupo de artículos por categoría (sección colapsable, patrón Z18). */
interface GrupoConteo {
  key: string;
  nombre: string;
  destacada: boolean;
  items: Existencia[];
  total: number;
}

const SIN_CATEGORIA_KEY = 'sin';

/** Guided physical count: adjust each article's stock to the counted value. */
@Component({
  selector: 'app-conteo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, BigConfirm, ConfirmDialog, CollapsibleSelect, ArticuloPicker, TranslatePipe],
  templateUrl: './conteo.html',
  styleUrl: './conteo.scss',
})
export class ConteoPage {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);
  private route = inject(ActivatedRoute);

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  existencias = signal<Existencia[]>([]);
  categorias = signal<CategoriaInv[]>([]); // Y9
  contado = signal<Record<string, number>>({});
  motivo = signal('');
  query = signal(''); // Y9 — buscador a través de todas las categorías
  loading = signal(false);
  // CC1 — catálogo oficial (cacheado offline) para "+ Agregar artículo".
  articulosCat = signal<ArticuloCat[]>([]);
  pickerAbierto = signal(false);
  /** CC1 — solo mostrar renglones con diferencia (contado ≠ sistema). */
  soloDiferencia = signal(false);
  /** CC1 — ids de artículos agregados desde el catálogo (chip "Agregado", Sistema 0). */
  private agregados = signal<Set<string>>(new Set());
  /** Y9 — categorías colapsadas manualmente (por key). */
  private colapsadas = signal<Set<string>>(new Set());
  submitting = signal(false);
  done = signal(false);
  confirmarConforme = signal(false);

  /** Items whose counted value differs from the system stock. */
  private cambios = computed(() =>
    this.existencias()
      .map((e) => ({ articulo_id: e.articulo_id, cantidad_contada: this.contado()[e.articulo_id] ?? e.cantidad }))
      .filter((it, i) => it.cantidad_contada !== this.existencias()[i].cantidad),
  );

  /** V8: with a bodega loaded but no edits, the user can still save "todo conforme". */
  hayCambios = computed(() => this.cambios().length > 0);
  puedeGuardar = computed(() => !!this.bodegaId() && this.existencias().length > 0);

  // ── Y9 — agrupación por categorías (patrón Z18 de existencias) ──
  buscando = computed(() => this.query().trim().length > 0);
  /** CC1 — contador "n de N" (mostrados de total). */
  nMostrados = computed(() => this.filtered().length);
  nTotal = computed(() => this.existencias().length);

  private filtered = computed(() => {
    const q = norm(this.query()); // CC1 — sin acentos ni mayúsculas
    const solo = this.soloDiferencia();
    const cont = this.contado();
    let list = this.existencias();
    if (q) list = list.filter((e) => norm(e.nombre).includes(q) || norm(e.codigo).includes(q));
    if (solo) list = list.filter((e) => (cont[e.articulo_id] ?? e.cantidad) !== e.cantidad);
    return list;
  });

  grupos = computed<GrupoConteo[]>(() => {
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const porCat = new Map<string, Existencia[]>();
    for (const e of this.filtered()) {
      const key = e.categoria_id != null ? String(e.categoria_id) : SIN_CATEGORIA_KEY;
      const arr = porCat.get(key);
      if (arr) arr.push(e);
      else porCat.set(key, [e]);
    }
    const out: GrupoConteo[] = [];
    for (const c of cats) {
      const items = porCat.get(String(c.id));
      if (!items?.length) continue;
      items.sort((a, b) => a.nombre.localeCompare(b.nombre));
      out.push({ key: String(c.id), nombre: c.nombre, destacada: c.destacada, items, total: items.length });
    }
    const sin = porCat.get(SIN_CATEGORIA_KEY);
    if (sin?.length) {
      sin.sort((a, b) => a.nombre.localeCompare(b.nombre));
      out.push({ key: SIN_CATEGORIA_KEY, nombre: this.i18n.t('Sin categoría'), destacada: false, items: sin, total: sin.length });
    }
    return out;
  });

  // ── CC1 — buscar en el catálogo oficial y agregar artículos que no aparecen ──
  /** Ids ya listados (para excluirlos del picker). */
  excludeIds = computed(() => this.existencias().map((e) => e.articulo_id));
  /** Búsqueda difusa para el picker (mismo patrón que otras capturas). */
  buscarFuzzy = (q: string): Promise<ArticuloCat[]> => this.inventario.buscarArticulos(q, 12);

  esAgregado(id: string): boolean {
    return this.agregados().has(id);
  }

  abrirPicker(): void {
    this.pickerAbierto.set(true);
  }
  cerrarPicker(): void {
    this.pickerAbierto.set(false);
  }

  /** CC1 — agrega un artículo del catálogo oficial: fila con Sistema 0, chip "Agregado".
   *  Entra al conteo como cualquier otro (el servidor acepta cantidad_antes = 0). */
  agregarArticulo(a: ArticuloCat): void {
    if (this.existencias().some((e) => e.articulo_id === a.id)) {
      this.cerrarPicker();
      return;
    }
    const fila: Existencia = {
      articulo_id: a.id,
      nombre: a.nombre,
      codigo: a.codigo,
      unidad: a.unidad,
      cantidad: 0, // Sistema 0 (no tenía existencia en este almacén)
      categoria_id: a.categoria_id,
      propiedad: a.propiedad,
      imagen_url: a.imagen_url,
    };
    // Al inicio para que se vea de una; contado 0 por defecto.
    this.existencias.update((list) => [fila, ...list]);
    this.contado.update((m) => ({ ...m, [a.id]: 0 }));
    this.agregados.update((s) => new Set(s).add(a.id));
    // Abre la categoría del agregado si estaba colapsada.
    const key = a.categoria_id != null ? String(a.categoria_id) : SIN_CATEGORIA_KEY;
    this.colapsadas.update((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    this.cerrarPicker();
  }

  abierto(key: string): boolean {
    if (this.buscando()) return true;
    return !this.colapsadas().has(key);
  }

  toggle(key: string): void {
    if (this.buscando()) return;
    this.colapsadas.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [b, cats, arts] = await Promise.all([
      this.inventario.getBodegas(),
      this.inventario.getCategorias().catch(() => []),
      this.inventario.getArticulos().catch(() => [] as ArticuloCat[]), // CC1 — catálogo (cache offline)
    ]);
    this.bodegas.set(b);
    this.categorias.set(cats);
    this.articulosCat.set(arts);
    // AS11 — preselección por ?bodega= (viene de "Contar/ajustar" del inventario del almacén).
    const preBodega = this.route.snapshot.queryParamMap.get('bodega');
    if (preBodega && b.some((x) => x.id === preBodega)) await this.onBodega(preBodega);
    else if (b.length === 1) await this.onBodega(b[0].id);
  }

  /** AS13 — ir al historial de conteos y ajustes. */
  verHistorial(): void {
    void this.router.navigate(['/inventario/conteos']);
  }

  async onBodega(id: string): Promise<void> {
    this.bodegaId.set(id);
    this.colapsadas.set(new Set());
    if (!id) return;
    this.loading.set(true);
    try {
      const ex = await this.inventario.getExistencias(id);
      this.existencias.set(ex);
      const init: Record<string, number> = {};
      for (const e of ex) init[e.articulo_id] = e.cantidad;
      this.contado.set(init);
    } finally {
      this.loading.set(false);
    }
  }

  setContado(articuloId: string, v: number): void {
    this.contado.update((m) => ({ ...m, [articuloId]: Math.max(0, v ?? 0) }));
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error(this.i18n.t('Elige la bodega.'));
      return;
    }
    // V8: no changes → confirm "todo conforme" instead of blocking the save.
    if (!this.hayCambios()) {
      this.confirmarConforme.set(true);
      return;
    }
    await this.guardar(this.cambios());
  }

  /** V8: user confirmed saving with no differences (todo conforme). We send all
   *  existencias as verified items so the record shows what was checked. */
  async confirmarSinDiferencias(): Promise<void> {
    this.confirmarConforme.set(false);
    const todos = this.existencias().map((e) => ({
      articulo_id: e.articulo_id,
      cantidad_contada: this.contado()[e.articulo_id] ?? e.cantidad,
    }));
    await this.guardar(todos);
  }

  cancelarConforme(): void {
    this.confirmarConforme.set(false);
  }

  private async guardar(items: { articulo_id: string; cantidad_contada: number }[]): Promise<void> {
    this.submitting.set(true);
    try {
      await this.inventario.enqueueConteo({
        bodegaId: this.bodegaId(),
        motivo: this.motivo().trim() || null,
        items,
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar.'));
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/inventario'], { replaceUrl: true });
  }
}
