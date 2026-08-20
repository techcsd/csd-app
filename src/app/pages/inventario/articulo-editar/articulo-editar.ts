import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';

interface ImagenArt {
  id: string;
  url: string;
  portada: boolean;
  orden: number;
}

/** AS20 — editar un artículo (admin + módulo inventario): nombre, unidad, categoría,
 *  nota + MÚLTIPLES fotos con portada (cámara o galería). Online. */
@Component({
  selector: 'app-articulo-editar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, CollapsibleSelect],
  templateUrl: './articulo-editar.html',
  styleUrl: './articulo-editar.scss',
})
export class ArticuloEditarPage {
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  loading = signal(true);
  guardando = signal(false);
  subiendoFoto = signal(false);
  private id = '';
  articulo = signal<ArticuloCat | null>(null);
  categorias = signal<CategoriaInv[]>([]);
  imagenes = signal<ImagenArt[]>([]);

  nombre = signal('');
  unidad = signal('');
  categoriaId = signal<number | null>(null);
  nota = signal('');

  categoriaOptions = computed(() => this.categorias().map((c) => ({ id: String(c.id), label: c.nombre })));
  categoriaSelId = computed(() => (this.categoriaId() != null ? String(this.categoriaId()) : ''));
  puedeGuardar = computed(() => this.nombre().trim().length > 0);

  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      const [a, cats] = await Promise.all([
        this.inventario.getArticulo(this.id),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
      ]);
      this.categorias.set(cats);
      if (a) {
        this.articulo.set(a);
        this.nombre.set(a.nombre);
        this.unidad.set(a.unidad ?? '');
        this.categoriaId.set(a.categoria_id ?? null);
        this.nota.set(a.nota ?? '');
      }
      await this.recargarImagenes();
    } finally {
      this.loading.set(false);
    }
  }

  private async recargarImagenes(): Promise<void> {
    this.imagenes.set(await this.inventario.getImagenesArticulo(this.id));
  }

  onCategoria(id: string): void {
    this.categoriaId.set(id ? Number(id) : null);
  }

  private async subir(blob: Blob): Promise<void> {
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para subir fotos.');
      return;
    }
    this.subiendoFoto.set(true);
    try {
      await this.inventario.agregarImagenArticulo(this.id, blob, this.imagenes().length === 0);
      await this.recargarImagenes();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo subir la foto.');
    } finally {
      this.subiendoFoto.set(false);
    }
  }
  async fotoCamara(): Promise<void> {
    const f = await this.camera.takePhoto();
    if (f) await this.subir(f.blob);
  }
  async fotoGaleria(): Promise<void> {
    const fs = await this.camera.pickFromGallery(1);
    if (fs[0]) await this.subir(fs[0].blob);
  }
  async hacerPortada(img: ImagenArt): Promise<void> {
    if (img.portada) return;
    try {
      await this.inventario.setPortadaArticulo(img.id);
      await this.recargarImagenes();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo fijar la portada.');
    }
  }
  async quitarFoto(img: ImagenArt): Promise<void> {
    try {
      await this.inventario.eliminarImagenArticulo(img.id);
      await this.recargarImagenes();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar la foto.');
    }
  }

  async guardar(): Promise<void> {
    if (this.guardando() || !this.puedeGuardar()) return;
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para guardar.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.inventario.actualizarArticulo(this.id, {
        nombre: this.nombre().trim(),
        unidad: this.unidad().trim(),
        categoriaId: this.categoriaId(),
        nota: this.nota().trim() || null,
      });
      this.toast.success('Artículo actualizado.');
      this.location.back();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el artículo.');
    } finally {
      this.guardando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
