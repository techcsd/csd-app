import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CategoriaInv } from '../../../core/models/inventario.model';

interface FotoNueva {
  blob: Blob;
  preview: string;
}

/** AS20 — crear un artículo nuevo (admin + módulo inventario): código AUTO por
 *  categoría, con creación inline de categoría/unidad y MÚLTIPLES fotos (la 1ª es
 *  portada). Online. */
@Component({
  selector: 'app-articulo-nuevo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect],
  templateUrl: './articulo-nuevo.html',
  styleUrl: './articulo-nuevo.scss',
})
export class ArticuloNuevoPage {
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  guardando = signal(false);
  categorias = signal<CategoriaInv[]>([]);
  unidades = signal<{ id: string; codigo: string; nombre: string }[]>([]);

  nombre = signal('');
  categoriaId = signal<number | null>(null);
  unidad = signal('');
  propiedad = signal('propio_csd');
  nota = signal('');
  fotos = signal<FotoNueva[]>([]);

  // Creación inline
  nuevaCategoria = signal('');
  creandoCategoria = signal(false);
  nuevaUnidad = signal('');
  creandoUnidad = signal(false);

  categoriaOptions = computed(() => this.categorias().map((c) => ({ id: String(c.id), label: c.nombre })));
  categoriaSelId = computed(() => (this.categoriaId() != null ? String(this.categoriaId()) : ''));
  unidadOptions = computed(() => this.unidades().map((u) => ({ id: u.codigo, label: u.nombre })));

  puedeGuardar = computed(() => this.nombre().trim().length > 0 && this.categoriaId() != null);

  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [cats, unis] = await Promise.all([
      this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
      this.inventario.getUnidades().catch(() => []),
    ]);
    this.categorias.set(cats);
    this.unidades.set(unis);
  }

  onCategoria(id: string): void {
    this.categoriaId.set(id ? Number(id) : null);
  }
  onUnidad(codigo: string): void {
    this.unidad.set(codigo);
  }

  async crearCategoria(): Promise<void> {
    const n = this.nuevaCategoria().trim();
    if (!n || this.creandoCategoria()) return;
    this.creandoCategoria.set(true);
    try {
      const id = await this.inventario.crearCategoria(n);
      this.categorias.set(await this.inventario.getCategorias());
      this.categoriaId.set(id);
      this.nuevaCategoria.set('');
      this.toast.success('Categoría creada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la categoría.');
    } finally {
      this.creandoCategoria.set(false);
    }
  }

  async crearUnidad(): Promise<void> {
    const n = this.nuevaUnidad().trim();
    if (!n || this.creandoUnidad()) return;
    this.creandoUnidad.set(true);
    try {
      await this.inventario.crearUnidad(n);
      this.unidades.set(await this.inventario.getUnidades());
      const nueva = this.unidades().find((u) => u.nombre.toLowerCase() === n.toLowerCase());
      if (nueva) this.unidad.set(nueva.codigo);
      this.nuevaUnidad.set('');
      this.toast.success('Unidad creada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la unidad.');
    } finally {
      this.creandoUnidad.set(false);
    }
  }

  async agregarFotoCamara(): Promise<void> {
    const f = await this.camera.takePhoto();
    if (f) this.fotos.update((l) => [...l, { blob: f.blob, preview: f.previewUrl }]);
  }
  async agregarFotoGaleria(): Promise<void> {
    const fs = await this.camera.pickFromGallery(1);
    if (fs[0]) this.fotos.update((l) => [...l, { blob: fs[0].blob, preview: fs[0].previewUrl }]);
  }
  quitarFoto(i: number): void {
    this.fotos.update((l) => {
      const f = l[i];
      if (f) URL.revokeObjectURL(f.preview);
      return l.filter((_, idx) => idx !== i);
    });
  }

  async guardar(): Promise<void> {
    if (this.guardando() || !this.puedeGuardar()) return;
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para crear el artículo.');
      return;
    }
    this.guardando.set(true);
    try {
      const { id, codigo } = await this.inventario.crearArticulo({
        nombre: this.nombre().trim(),
        categoriaId: this.categoriaId() as number,
        unidad: this.unidad().trim() || undefined,
        propiedad: this.propiedad(),
        nota: this.nota().trim() || undefined,
      });
      // Sube las fotos (la primera queda como portada).
      const fotos = this.fotos();
      for (let i = 0; i < fotos.length; i++) {
        await this.inventario.agregarImagenArticulo(id, fotos[i].blob, i === 0);
      }
      this.toast.success(`Artículo creado (${codigo}).`);
      void this.router.navigate(['/inventario/articulo', id]);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el artículo.');
    } finally {
      this.guardando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
