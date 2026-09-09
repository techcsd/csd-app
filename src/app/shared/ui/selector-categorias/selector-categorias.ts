import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ArticuloCat,
  CartLinea,
  CategoriaInv,
  esArticuloExterno,
  propiedadLabel,
} from '../../../core/models/inventario.model';
import { Skeleton } from '../skeleton/skeleton';

const SIN_CATEGORIA = -1;
/** Custom "Otros" lines get a synthetic id so the cart keys stay unique; the
 *  consuming page maps `otro:*` back to a null articulo_id for the RPC. */
const OTRO_PREFIX = 'otro:';

interface CategoriaChip {
  id: number;
  nombre: string;
  destacada: boolean;
  disponibles: number;
  seleccionados: number;
  esOtros: boolean;
}

/**
 * Reusable category-sheet selector (patrón "HOJAS" del jefe). Two full-screen
 * sheets: (1) categories — destacadas first, each with a badge of items already
 * picked; (2) the tapped category's articles with a − / + stepper. The cart is a
 * two-way `model` so the parent owns it. Emits `siguiente` / `cancelar`.
 *
 * V14: EPP articles flagged `requiere_talla` ask for a size before they enter
 * the cart; packing/brand notes show as a hint. In `requisicion` mode the "Otros"
 * category (08) lets the user describe a material that isn't in the catalog.
 */
@Component({
  selector: 'app-selector-categorias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton],
  templateUrl: './selector-categorias.html',
  styleUrl: './selector-categorias.scss',
})
export class SelectorCategorias {
  articulos = input<ArticuloCat[]>([]);
  categorias = input<CategoriaInv[]>([]);
  loading = input(false); // V7: shimmer while the catalog loads (no blank grid)
  /** 'requisicion' unlocks the free-text "Otros" flow (V14/08). */
  modo = input<'stock' | 'requisicion'>('stock');
  /**
   * AB1 — modo "solo buscador": una sola pantalla con un buscador prominente que
   * filtra el catálogo en tiempo real (nombre o código), sin el listado de
   * categorías. Opt-in (solo Requisición lo activa); salida/entrada/conteo siguen
   * con el patrón de categorías intacto.
   */
  soloBuscador = input(false);
  /** BC2 — unidades para el desplegable de material NO catalogado (AU13). */
  unidades = input<string[]>([]);
  cart = model<CartLinea[]>([]);

  siguiente = output<void>();
  cancelar = output<void>();

  hoja = signal<'categorias' | 'categoria'>('categorias');
  catSelId = signal<number | null>(null);
  query = signal('');

  // Talla dialog (EPP)
  tallaFor = signal<ArticuloCat | null>(null);
  tallaValor = signal('');
  private tallaPendiente = 1; // APP-003: cantidad tecleada/steppeada al abrir el modal
  readonly tallasComunes = ['S', 'M', 'L', 'XL', 'XXL'];

  // "Otros" describe form
  otroDesc = signal('');
  otroUnidad = signal('UND');
  otroCant = signal(1);

  totalCarrito = computed(() => this.cart().length);

  private childrenOf(catId: number): Set<number> {
    return new Set(this.categorias().filter((c) => c.padre_id === catId).map((c) => c.id));
  }

  private perteneceA(articulo: ArticuloCat, catId: number): boolean {
    if (catId === SIN_CATEGORIA) return articulo.categoria_id == null;
    if (articulo.categoria_id === catId) return true;
    return articulo.categoria_id != null && this.childrenOf(catId).has(articulo.categoria_id);
  }

  private esOtros(c: { nombre: string }): boolean {
    return /^otros$/i.test(c.nombre.trim());
  }

  /** Id of the official "Otros" (08) category, if present. */
  otrosCatId = computed(() => this.categorias().find((c) => this.esOtros(c))?.id ?? null);

  /** Custom lines already added under "Otros". */
  otrosLineas = computed(() =>
    this.cart().filter((l) => typeof l.articulo_id === 'string' && l.articulo_id.startsWith(OTRO_PREFIX)),
  );

  /** Category chips: official order (orden), destacadas first; only non-empty —
   *  except "Otros" in requisición mode, which is always offered. */
  chips = computed<CategoriaChip[]>(() => {
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const out: CategoriaChip[] = cats.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      destacada: c.destacada,
      disponibles: this.articulos().filter((a) => this.perteneceA(a, c.id)).length,
      seleccionados: this.contarSeleccionados(c.id),
      esOtros: this.esOtros(c),
    }));
    if (this.articulos().some((a) => a.categoria_id == null)) {
      out.push({
        id: SIN_CATEGORIA,
        nombre: 'Sin categoría',
        destacada: false,
        disponibles: this.articulos().filter((a) => a.categoria_id == null).length,
        seleccionados: this.cart().filter((l) => l.categoria_id == null && !this.esCustom(l)).length,
        esOtros: false,
      });
    }
    // Show categories with articles; keep "Otros" visible in requisición mode.
    return out.filter((c) => c.disponibles > 0 || (c.esOtros && this.modo() === 'requisicion'));
  });

  private esCustom(l: CartLinea): boolean {
    return typeof l.articulo_id === 'string' && l.articulo_id.startsWith(OTRO_PREFIX);
  }

  private contarSeleccionados(catId: number): number {
    return this.cart().filter((l) => {
      if (this.esCustom(l)) return l.categoria_id === catId;
      const art = this.articulos().find((a) => a.id === l.articulo_id);
      return art ? this.perteneceA(art, catId) : false;
    }).length;
  }

  categoriaAbierta = computed(() => this.categorias().find((c) => c.id === this.catSelId()) ?? null);
  esOtrosAbierta = computed(() => {
    const c = this.categoriaAbierta();
    // APP-019: el formulario de texto libre "Otros" solo en modo requisición;
    // en salida/entrada (stock) siempre se muestran los artículos de la categoría.
    return !!c && this.esOtros(c) && this.modo() === 'requisicion';
  });

  nombreCategoria = computed(() => {
    const id = this.catSelId();
    if (id === SIN_CATEGORIA) return 'Sin categoría';
    return this.categorias().find((c) => c.id === id)?.nombre ?? '';
  });

  /** Articles of the open category, filtered by the in-category search. */
  articulosVisibles = computed<ArticuloCat[]>(() => {
    const id = this.catSelId();
    if (id == null) return [];
    const q = this.query().toLowerCase().trim();
    return this.articulos()
      .filter((a) => this.perteneceA(a, id))
      .filter((a) => !q || a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q));
  });

  // ── Z16 — agrupación CSD (propios) / Alquilados (externos) + badge ──
  readonly propiedadLabel = propiedadLabel;
  esExterno(a: ArticuloCat): boolean {
    return esArticuloExterno(a.propiedad);
  }
  /** Z16 — los artículos de la categoría abierta, en dos grupos por propiedad
   *  (solo se separan si conviven CSD y alquilados; si no, lista simple). */
  articulosGrupos = computed<{ label: string; items: ArticuloCat[] }[]>(() => {
    const vis = this.articulosVisibles();
    const csd = vis.filter((a) => !this.esExterno(a));
    const ext = vis.filter((a) => this.esExterno(a));
    if (csd.length && ext.length) {
      return [
        { label: 'CSD (propios)', items: csd },
        { label: 'Alquilados (externos)', items: ext },
      ];
    }
    return [{ label: '', items: vis }];
  });

  // ── AB1 — buscador global (solo requisición) ──
  private static readonly RESULTADOS_MAX = 40;

  /** Resultados del buscador global: filtra por nombre o código; vacío si no hay
   *  texto (estado inicial → se muestran los seleccionados / el hint). */
  resultados = computed<ArticuloCat[]>(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return [];
    return this.articulos().filter(
      (a) => a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q),
    );
  });

  /** Recorte para no pintar cientos de filas de golpe (el catálogo es grande). */
  resultadosMostrados = computed(() => this.resultados().slice(0, SelectorCategorias.RESULTADOS_MAX));
  hayMasResultados = computed(() => this.resultados().length > SelectorCategorias.RESULTADOS_MAX);

  /** Agrega como material libre lo que el usuario tecleó (no está en el catálogo);
   *  reusa el flujo "Otros" existente y limpia el buscador. */
  agregarLibreDesdeBusqueda(): void {
    const desc = this.query().trim();
    if (!desc) return;
    this.otroDesc.set(desc);
    this.otroUnidad.set('UND');
    this.otroCant.set(1);
    this.agregarOtro();
    this.query.set('');
  }

  /** Quita una línea del carrito por su id (catálogo o "otros"). */
  quitarLinea(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  // ── BC2 — edición en línea de un material NO catalogado (cantidad + unidad) ──
  /** ¿La línea del carrito es un "Otros" (no catalogado)? */
  esCustomLinea(l: CartLinea): boolean {
    return this.esCustom(l);
  }
  /** Fija la cantidad de una línea "Otros" (permite vacío transitorio → 0). */
  setCantidadLinea(articuloId: string, v: number): void {
    const cant = Math.max(0, Math.floor((v || 0) * 100) / 100);
    this.cart.update((list) => list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l)));
  }
  /** ± sobre una línea "Otros" (mínimo 1). */
  ajustarOtro(articuloId: string, delta: number): void {
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.max(1, (l.cantidad || 0) + delta) } : l)),
    );
  }
  /** Cambia la unidad de una línea "Otros" (dropdown AU13 + texto libre). */
  setUnidadLinea(articuloId: string, unidad: string): void {
    const u = (unidad ?? '').trim() || 'UND';
    this.cart.update((list) => list.map((l) => (l.articulo_id === articuloId ? { ...l, unidad: u } : l)));
  }

  cantidadDe(articuloId: string): number {
    return this.cart().find((l) => l.articulo_id === articuloId)?.cantidad ?? 0;
  }

  tallaDe(articuloId: string): string | null {
    return this.cart().find((l) => l.articulo_id === articuloId)?.talla ?? null;
  }

  abrirCategoria(catId: number): void {
    this.catSelId.set(catId);
    this.query.set('');
    this.resetOtroForm();
    this.hoja.set('categoria');
  }

  volverCategorias(): void {
    this.hoja.set('categorias');
    this.catSelId.set(null);
  }

  // ── BM5 — captura por EMPAQUE (atado/paquete) ─────────────────────────────
  // El número que el usuario ve/teclea está en la UNIDAD ACTIVA (empaques si el
  // toggle está en "atado", unidad base si no); la `cantidad` guardada en el
  // carrito va SIEMPRE en unidad base (base = mostrado × factor). Así el stock,
  // el kardex y el costeo no se tocan — solo se ENRIQUECE el renglón con
  // unidad_capturada + factor_aplicado para poder mostrar "2 atados (240 PZA)".
  private porPaquete = signal<Set<string>>(new Set());

  /** ¿El artículo trae empaque máquina-legible (factor>1)? → ofrece el toggle. */
  puedeEmpaque(a: ArticuloCat): boolean {
    return (a.factor_paquete ?? 0) > 1 && !!a.unidad_paquete;
  }
  /** ¿Se está capturando este artículo POR empaque? */
  porEmpaqueDe(id: string): boolean {
    return this.porPaquete().has(id);
  }
  /** Factor efectivo del artículo según el modo actual (1 = unidad base). */
  private factorDe(a: ArticuloCat): number {
    return this.porEmpaqueDe(a.id) && this.puedeEmpaque(a) ? (a.factor_paquete as number) : 1;
  }
  /** Cantidad MOSTRADA en la unidad activa (empaques si porEmpaque, si no base). */
  cantidadMostrada(a: ArticuloCat): number {
    const f = this.factorDe(a);
    const base = this.cantidadDe(a.id);
    return f > 1 ? Math.round((base / f) * 100) / 100 : base;
  }
  /** Equivalencia en unidad base para el hint "= 240 PZA" (solo por empaque). */
  equivBase(a: ArticuloCat): number | null {
    if (!this.porEmpaqueDe(a.id) || !this.puedeEmpaque(a)) return null;
    const base = this.cantidadDe(a.id);
    return base > 0 ? base : null;
  }
  /** Alterna unidad base ⇄ empaque conservando la cantidad física (base). */
  setEmpaque(a: ArticuloCat, on: boolean): void {
    if (!this.puedeEmpaque(a) || on === this.porEmpaqueDe(a.id)) return;
    this.porPaquete.update((s) => {
      const n = new Set(s);
      if (on) n.add(a.id);
      else n.delete(a.id);
      return n;
    });
    // Re-aplica la MISMA base con la nueva traza (2 atados ⇄ 240 base = mismo físico).
    const base = this.cantidadDe(a.id);
    if (base > 0) this.aplicar(a, base, this.tallaDe(a.id));
  }

  // ── Stepper (con talla para EPP + empaque BM5) ──
  // `valor`/`delta` llegan en la UNIDAD ACTIVA; se convierten a base antes de guardar.
  setCantidad(a: ArticuloCat, valorMostrado: number): void {
    const f = this.factorDe(a);
    const shown = Math.max(0, Math.floor((valorMostrado || 0) * 100) / 100);
    const base = f > 1 ? Math.round(shown * f * 100) / 100 : shown;
    if (a.requiere_talla && base > 0 && !this.tallaDe(a.id)) {
      this.abrirTalla(a, base); // APP-003: conserva la cantidad tecleada (en base)
      return;
    }
    this.aplicar(a, base, this.tallaDe(a.id));
  }

  ajustar(a: ArticuloCat, delta: number): void {
    const f = this.factorDe(a);
    const shownNext = Math.max(0, this.cantidadMostrada(a) + delta);
    const base = f > 1 ? Math.round(shownNext * f * 100) / 100 : shownNext;
    if (a.requiere_talla && base > 0 && !this.tallaDe(a.id)) {
      this.abrirTalla(a, base);
      return;
    }
    this.aplicar(a, base, this.tallaDe(a.id));
  }

  /** Escribe/actualiza el renglón. `cantidad` SIEMPRE en unidad base; añade la
   *  traza de empaque (unidad_capturada/factor_aplicado) según el modo actual. */
  private aplicar(a: ArticuloCat, cantidad: number, talla: string | null): void {
    const f = this.factorDe(a);
    const unidadCap = f > 1 ? a.unidad_paquete ?? null : null;
    this.cart.update((list) => {
      const idx = list.findIndex((l) => l.articulo_id === a.id);
      if (cantidad <= 0) return idx >= 0 ? list.filter((_, i) => i !== idx) : list;
      if (idx >= 0)
        return list.map((l, i) =>
          i === idx ? { ...l, cantidad, talla, unidad_capturada: unidadCap, factor_aplicado: f } : l,
        );
      return [
        ...list,
        {
          articulo_id: a.id,
          nombre: a.nombre,
          unidad: a.unidad,
          categoria_id: a.categoria_id,
          cantidad,
          talla,
          unidad_capturada: unidadCap,
          factor_aplicado: f,
        },
      ];
    });
  }

  // ── Talla dialog ──
  abrirTalla(a: ArticuloCat, cant?: number): void {
    this.tallaFor.set(a);
    this.tallaValor.set(this.tallaDe(a.id) ?? '');
    // APP-003: recuerda la cantidad en curso (tecleada/stepper o la actual del carrito).
    this.tallaPendiente = Math.max(1, cant ?? (this.cantidadDe(a.id) || 1));
  }

  confirmarTalla(): void {
    const a = this.tallaFor();
    const talla = this.tallaValor().trim();
    if (!a || !talla) return;
    const cant = Math.max(1, this.cantidadDe(a.id) || this.tallaPendiente);
    this.aplicar(a, cant, talla);
    this.tallaFor.set(null);
    this.tallaValor.set('');
  }

  cancelarTalla(): void {
    this.tallaFor.set(null);
    this.tallaValor.set('');
  }

  // ── Otros (free-text) ──
  private resetOtroForm(): void {
    this.otroDesc.set('');
    this.otroUnidad.set('UND');
    this.otroCant.set(1);
  }

  agregarOtro(): void {
    const desc = this.otroDesc().trim();
    const cant = Math.max(1, Math.floor((this.otroCant() || 0) * 100) / 100);
    const catId = this.otrosCatId();
    if (!desc) return;
    this.cart.update((list) => [
      ...list,
      {
        articulo_id: OTRO_PREFIX + crypto.randomUUID(),
        nombre: desc,
        unidad: this.otroUnidad().trim() || 'UND',
        categoria_id: catId,
        cantidad: cant,
        descripcion: desc,
      },
    ]);
    this.resetOtroForm();
  }

  quitarOtro(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  onSiguiente(): void {
    if (this.totalCarrito() > 0) this.siguiente.emit();
  }

  onCancelar(): void {
    this.cancelar.emit();
  }
}
