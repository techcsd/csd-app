import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';

/** AS20 — editar un artículo del catálogo (admin + módulo inventario): nombre,
 *  unidad, categoría, nota e IMAGEN (cámara o galería). Online (editar el catálogo
 *  no es trabajo de campo). Al guardar, la imagen se ve en el catálogo y pickers. */
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
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  guardando = signal(false);
  private id = '';
  articulo = signal<ArticuloCat | null>(null);
  categorias = signal<CategoriaInv[]>([]);

  nombre = signal('');
  unidad = signal('');
  categoriaId = signal<number | null>(null);
  nota = signal('');
  imagenActual = signal<string | null>(null); // URL pública existente
  private nuevaImagen = signal<Blob | null>(null);
  nuevaPreview = signal<string | null>(null);

  categoriaOptions = computed(() => this.categorias().map((c) => ({ id: String(c.id), label: c.nombre })));
  categoriaSelId = computed(() => (this.categoriaId() != null ? String(this.categoriaId()) : ''));
  imagenMostrada = computed(() => this.nuevaPreview() ?? this.imagenActual());

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
        this.imagenActual.set(a.imagen_url ?? null);
      }
    } finally {
      this.loading.set(false);
    }
  }

  onCategoria(id: string): void {
    this.categoriaId.set(id ? Number(id) : null);
  }

  async tomarFoto(): Promise<void> {
    const foto = await this.camera.takePhoto();
    if (foto) this.setImagen(foto.blob, foto.previewUrl);
  }
  async elegirGaleria(): Promise<void> {
    const fotos = await this.camera.pickFromGallery(1);
    if (fotos[0]) this.setImagen(fotos[0].blob, fotos[0].previewUrl);
  }
  private setImagen(blob: Blob, preview: string): void {
    const prev = this.nuevaPreview();
    if (prev) URL.revokeObjectURL(prev);
    this.nuevaImagen.set(blob);
    this.nuevaPreview.set(preview);
  }

  puedeGuardar = computed(() => this.nombre().trim().length > 0);

  async guardar(): Promise<void> {
    if (this.guardando() || !this.puedeGuardar()) return;
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para editar el artículo.');
      return;
    }
    this.guardando.set(true);
    try {
      let imagenUrl: string | undefined;
      const blob = this.nuevaImagen();
      if (blob) imagenUrl = await this.inventario.subirImagenArticulo(this.id, blob);
      await this.inventario.actualizarArticulo(this.id, {
        nombre: this.nombre().trim(),
        unidad: this.unidad().trim(),
        categoriaId: this.categoriaId(),
        nota: this.nota().trim() || null,
        ...(imagenUrl ? { imagenUrl } : {}),
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
