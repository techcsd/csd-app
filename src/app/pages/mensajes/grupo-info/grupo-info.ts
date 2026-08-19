import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { MensajesService, GrupoInfo, GrupoParticipante } from '../../../core/services/mensajes.service';
import { InventarioService, UsuarioBusqueda } from '../../../core/services/inventario.service';
import { CameraService } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AvatarEditor } from '../../../shared/ui/avatar-editor/avatar-editor';

/**
 * AN6 — Info y gestión de un grupo tipo WhatsApp: foto/nombre/descripción
 * editables (admin), lista de participantes con rol, agregar/quitar/promover, y
 * salir del grupo. Consume los contratos SECURITY DEFINER de PROMPT-7 FASE 5
 * (grupo_info/editar/agregar/quitar/promover/salir/set_avatar). Las acciones de
 * gestión son ONLINE (validan y devuelven estado del server); el hilo registra
 * cada cambio como evento de sistema.
 */
@Component({
  selector: 'app-grupo-info',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, AvatarEditor],
  templateUrl: './grupo-info.html',
  styleUrl: './grupo-info.scss',
})
export class GrupoInfoPage {
  private mensajes = inject(MensajesService);
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  conversacionId = '';
  loading = signal(true);
  info = signal<GrupoInfo | null>(null);
  avatarUrl = signal<string | null>(null);
  guardando = signal(false);

  soyAdmin = computed(() => this.info()?.mi_rol === 'admin');

  // Editar nombre/descripción.
  editando = signal(false);
  nombre = signal('');
  descripcion = signal('');

  // Agregar participante (búsqueda).
  agregando = signal(false);
  busqueda = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);

  constructor() {
    this.conversacionId = this.route.snapshot.paramMap.get('id') ?? '';
    void this.cargar();
  }

  get online(): boolean {
    return this.net.online();
  }

  private async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const info = await this.mensajes.grupoInfo(this.conversacionId);
      this.info.set(info);
      this.nombre.set(info.nombre ?? '');
      this.descripcion.set(info.descripcion ?? '');
      this.avatarUrl.set(await this.mensajes.avatarUrl(info.avatar_path));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar el grupo.');
      this.back();
    } finally {
      this.loading.set(false);
    }
  }

  inicial(nombre: string | null): string {
    return (nombre ?? '?').trim().charAt(0).toUpperCase() || '?';
  }

  esCreador(p: GrupoParticipante): boolean {
    return p.es_creador;
  }

  // ── Editar nombre/descripción ────────────────────────────────────────────────
  abrirEditar(): void {
    if (!this.soyAdmin()) return;
    this.nombre.set(this.info()?.nombre ?? '');
    this.descripcion.set(this.info()?.descripcion ?? '');
    this.editando.set(true);
  }

  async guardarEdicion(): Promise<void> {
    const n = this.nombre().trim();
    if (!n) {
      this.toast.error('El grupo necesita un nombre.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.mensajes.grupoEditar(this.conversacionId, n, this.descripcion().trim() || null);
      this.editando.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Avatar ───────────────────────────────────────────────────────────────────
  // AW7 — imagen elegida pendiente de ajustar en el editor (recorte circular).
  editorImagen = signal<Blob | null>(null);

  async cambiarAvatar(desde: 'camara' | 'galeria'): Promise<void> {
    if (!this.soyAdmin() || this.guardando()) return;
    const foto =
      desde === 'camara' ? await this.camera.takePhoto() : (await this.camera.pickFromGallery(1))[0] ?? null;
    if (!foto) return;
    // AW7 — abre el editor (recorte + zoom) antes de subir.
    this.editorImagen.set(foto.blob);
  }

  /** AW7 — el editor devolvió la foto recortada (JPEG cuadrada) → subir. */
  async onAvatarEditado(blob: Blob): Promise<void> {
    this.editorImagen.set(null);
    this.guardando.set(true);
    try {
      await this.mensajes.cambiarAvatarGrupo(this.conversacionId, blob);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar la foto.');
    } finally {
      this.guardando.set(false);
    }
  }
  onAvatarCancel(): void {
    this.editorImagen.set(null);
  }

  // ── Participantes ─────────────────────────────────────────────────────────────
  toggleAgregar(): void {
    this.agregando.update((v) => !v);
    this.busqueda.set('');
    this.resultados.set([]);
  }

  async buscar(): Promise<void> {
    const term = this.busqueda().trim();
    if (term.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      const yaDentro = new Set((this.info()?.participantes ?? []).map((p) => p.usuario_id));
      this.resultados.set((await this.inventario.buscarUsuarios(term)).filter((u) => !yaDentro.has(u.id)));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }

  async agregar(u: UsuarioBusqueda): Promise<void> {
    try {
      await this.mensajes.grupoAgregar(this.conversacionId, u.id);
      this.agregando.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar.');
    }
  }

  async quitar(p: GrupoParticipante): Promise<void> {
    if (!confirm(`¿Quitar a ${p.nombre ?? 'este participante'} del grupo?`)) return;
    try {
      await this.mensajes.grupoQuitar(this.conversacionId, p.usuario_id);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo quitar.');
    }
  }

  async promover(p: GrupoParticipante, admin: boolean): Promise<void> {
    try {
      await this.mensajes.grupoPromover(this.conversacionId, p.usuario_id, admin);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el rol.');
    }
  }

  async salir(): Promise<void> {
    if (!confirm('¿Salir de este grupo? Dejarás de recibir sus mensajes.')) return;
    try {
      await this.mensajes.grupoSalir(this.conversacionId);
      this.toast.success('Saliste del grupo.');
      void this.router.navigate(['/mensajes']);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo salir del grupo.');
    }
  }

  back(): void {
    this.location.back();
  }
}
