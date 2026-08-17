import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { MensajesService } from '../../../core/services/mensajes.service';
import { InventarioService, UsuarioBusqueda } from '../../../core/services/inventario.service';
import { CameraService } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * AS25 — creación de grupo tipo WhatsApp en una pantalla completa: foto, nombre,
 * descripción e integrantes con buscador. Reutiliza los contratos existentes
 * (crear_grupo → grupo_editar → grupo_set_avatar). La foto se sube DESPUÉS de
 * crear el grupo porque la RLS del bucket la scopea por conversación.
 */
@Component({
  selector: 'app-nuevo-grupo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './nuevo-grupo.html',
  styleUrl: './nuevo-grupo.scss',
})
export class NuevoGrupoPage implements OnDestroy {
  private mensajes = inject(MensajesService);
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  nombre = signal('');
  descripcion = signal('');
  seleccionados = signal<UsuarioBusqueda[]>([]);

  // Foto del grupo (se sube tras crear).
  private avatarBlob: Blob | null = null;
  avatarPreview = signal<string | null>(null);

  // Buscador de integrantes.
  busqueda = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);

  creando = signal(false);

  puedeCrear = computed(() => this.nombre().trim().length > 0 && this.seleccionados().length > 0);

  ngOnDestroy(): void {
    if (this.avatarPreview()) URL.revokeObjectURL(this.avatarPreview()!);
  }

  async elegirFoto(desde: 'camara' | 'galeria'): Promise<void> {
    try {
      const foto =
        desde === 'camara' ? await this.camera.takePhoto() : (await this.camera.pickFromGallery(1))[0] ?? null;
      if (!foto) return;
      if (this.avatarPreview()) URL.revokeObjectURL(this.avatarPreview()!);
      this.avatarBlob = foto.blob;
      this.avatarPreview.set(URL.createObjectURL(foto.blob));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo tomar la foto.');
    }
  }

  quitarFoto(): void {
    if (this.avatarPreview()) URL.revokeObjectURL(this.avatarPreview()!);
    this.avatarBlob = null;
    this.avatarPreview.set(null);
  }

  estaSeleccionado(u: UsuarioBusqueda): boolean {
    return this.seleccionados().some((s) => s.id === u.id);
  }

  toggle(u: UsuarioBusqueda): void {
    this.seleccionados.update((l) => (l.some((s) => s.id === u.id) ? l.filter((s) => s.id !== u.id) : [...l, u]));
  }

  quitar(u: UsuarioBusqueda): void {
    this.seleccionados.update((l) => l.filter((s) => s.id !== u.id));
  }

  async buscar(): Promise<void> {
    const term = this.busqueda().trim();
    if (term.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      const ya = new Set(this.seleccionados().map((s) => s.id));
      this.resultados.set((await this.inventario.buscarUsuarios(term)).filter((u) => !ya.has(u.id)));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }

  async crear(): Promise<void> {
    if (!this.puedeCrear() || this.creando()) return;
    this.creando.set(true);
    try {
      const id = await this.mensajes.crearGrupo(
        this.nombre().trim(),
        this.seleccionados().map((s) => s.id),
      );
      // Descripción + foto (best-effort: si fallan, el grupo ya existe).
      const desc = this.descripcion().trim();
      if (desc) {
        try {
          await this.mensajes.grupoEditar(id, this.nombre().trim(), desc);
        } catch {
          /* el grupo ya está creado; la descripción se puede editar luego */
        }
      }
      if (this.avatarBlob) {
        try {
          await this.mensajes.cambiarAvatarGrupo(id, this.avatarBlob);
        } catch {
          /* la foto se puede poner luego desde la info del grupo */
        }
      }
      this.router.navigate(['/mensajes', id]);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el grupo.');
    } finally {
      this.creando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
