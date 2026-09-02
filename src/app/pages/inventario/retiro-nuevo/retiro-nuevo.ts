import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { QtyInput } from '../../../shared/ui/qty-input/qty-input';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { RetirosService } from '../../../core/services/retiros.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { Proyecto } from '../../../core/models/bitacora.model';
import { ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';
import { combinarUnidades } from '../../../core/util/unidades';
import { RetiroItemCaptura, RetiroMotivoDano, RETIRO_MOTIVO_LABEL } from '../../../core/models/retiro.model';

const MOTIVOS: { value: RetiroMotivoDano; icon: string }[] = [
  { value: 'danado_obra', icon: '🏗️' },
  { value: 'defecto_fabrica', icon: '🏭' },
  { value: 'vencido', icon: '⏰' },
  { value: 'otro', icon: '✍️' },
];

/**
 * BG4 — Solicitud de RETIRO de material dañado (nace en la obra, offline-first).
 * Artículo (catálogo con apodos AU12 o descripción libre) + cantidad + motivo del
 * daño + FOTOS OBLIGATORIAS (la evidencia es el corazón del control). Entra al
 * outbox como todo lo demás (3 categorías de BG1).
 */
@Component({
  selector: 'app-retiro-nuevo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect, ArticuloPicker, QtyInput, OptionButton, ConfirmDialog, Skeleton],
  templateUrl: './retiro-nuevo.html',
  styleUrl: './retiro-nuevo.scss',
})
export class RetiroNuevoPage implements OnDestroy {
  private retiros = inject(RetirosService);
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  readonly motivos = MOTIVOS;
  readonly motivoLabel = RETIRO_MOTIVO_LABEL;

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  unidades = signal<string[]>([]);
  loadingCat = signal(true);

  items = signal<RetiroItemCaptura[]>([]);
  descripcionLibre = signal('');
  motivo = signal<RetiroMotivoDano | null>(null);
  motivoDetalle = signal('');
  notas = signal('');
  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  online = this.network.online;

  proyectoOpciones = computed<SelectOption[]>(() =>
    this.proyectos().map((p) => ({ id: p.id, label: p.nombre })),
  );
  excludeIds = computed(() => this.items().map((i) => i.articulo_id).filter((x): x is string => !!x));

  buscador = (q: string) => this.inventario.buscarArticulos(q).then((r) => r as ArticuloCat[]);

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos() && !this.done()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.init();
    this.navGuard.register(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loadingCat.set(true);
    try {
      const [p, a, cat] = await Promise.all([
        this.retiros.getProyectos(),
        this.inventario.getArticulos(),
        this.inventario.getCategorias(),
      ]);
      this.proyectos.set(p);
      this.articulos.set(a);
      this.categorias.set(cat);
      this.inventario
        .getUnidades()
        .then((u) => this.unidades.set(combinarUnidades(u.map((x) => x.nombre || x.codigo))))
        .catch(() => this.unidades.set(combinarUnidades([])));
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (p.length === 1) this.proyectoId.set(p[0].id);
    } finally {
      this.loadingCat.set(false);
    }
  }

  // ── Artículos ────────────────────────────────────────────────────────────

  addArticulo(a: ArticuloCat): void {
    if (this.items().some((i) => i.articulo_id === a.id)) return;
    this.items.update((l) => [
      { articulo_id: a.id, descripcion: a.nombre, cantidad: 1, unidad: a.unidad || 'UND' },
      ...l,
    ]);
  }

  addDescripcion(): void {
    const desc = this.descripcionLibre().trim();
    if (!desc) return;
    this.items.update((l) => [{ articulo_id: null, descripcion: desc, cantidad: 1, unidad: 'UND' }, ...l]);
    this.descripcionLibre.set('');
  }

  setCantidad(i: number, v: number): void {
    this.items.update((l) => l.map((x, idx) => (idx === i ? { ...x, cantidad: Math.max(0.01, v || 0) } : x)));
  }
  setUnidad(i: number, u: string): void {
    this.items.update((l) => l.map((x, idx) => (idx === i ? { ...x, unidad: u || null } : x)));
  }
  removeItem(i: number): void {
    this.items.update((l) => l.filter((_, idx) => idx !== i));
  }

  // ── Motivo ───────────────────────────────────────────────────────────────
  pickMotivo(m: RetiroMotivoDano): void {
    this.motivo.set(m);
  }

  // ── Fotos (obligatorias) ─────────────────────────────────────────────────
  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) this.fotos.update((f) => [...f, photo]);
    } finally {
      this.capturing.set(false);
    }
  }
  async addFromGallery(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photos = await this.camera.pickFromGallery();
      if (photos.length) this.fotos.update((f) => [...f, ...photos]);
    } finally {
      this.capturing.set(false);
    }
  }
  removeFoto(i: number): void {
    const f = this.fotos()[i];
    if (f) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((l) => l.filter((_, idx) => idx !== i));
  }

  // ── Envío ────────────────────────────────────────────────────────────────

  private tieneDatos(): boolean {
    return (
      this.items().length > 0 ||
      this.fotos().length > 0 ||
      !!this.motivo() ||
      !!this.notas().trim()
    );
  }

  puedeEnviar = computed(
    () =>
      !!this.proyectoId() &&
      this.items().length > 0 &&
      !!this.motivo() &&
      (this.motivo() !== 'otro' || !!this.motivoDetalle().trim()) &&
      this.fotos().length > 0,
  );

  async enviar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    if (!this.items().length) {
      this.toast.error('Agrega al menos un artículo dañado.');
      return;
    }
    if (!this.motivo()) {
      this.toast.error('Elige el motivo del daño.');
      return;
    }
    if (this.motivo() === 'otro' && !this.motivoDetalle().trim()) {
      this.toast.error('Describe el motivo del daño.');
      return;
    }
    if (!this.fotos().length) {
      this.toast.error('Toma al menos una foto del material dañado.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.retiros.enqueueRetiro({
        proyectoId: this.proyectoId(),
        motivoDano: this.motivo()!,
        motivoDanoDetalle: this.motivo() === 'otro' ? this.motivoDetalle().trim() : null,
        notas: this.notas().trim() || null,
        items: this.items(),
        fotos: this.fotos().map((f) => f.blob),
        esPrueba: this.ctx.esPrueba(),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el retiro.');
    } finally {
      this.submitting.set(false);
    }
  }

  irAMisRetiros(): void {
    void this.router.navigate(['/inventario/retiros'], { replaceUrl: true });
  }

  salir(): void {
    if (this.tieneDatos() && !this.done()) this.confirmSalir.set(true);
    else this.back();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  back(): void {
    this.location.back();
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    for (const f of this.fotos()) URL.revokeObjectURL(f.previewUrl);
  }
}
