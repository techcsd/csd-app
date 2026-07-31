import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { NotasService } from '../../../core/services/notas.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import {
  Nota,
  NotaCompartido,
  NotaPermiso,
  NOTA_COLORES,
  UsuarioBusqueda,
} from '../../../core/models/nota.model';

/**
 * AC4 — Editor de nota: título + contenido + color + fijar + archivar, y (para el
 * dueño) compartir con permiso ver/editar. Guarda por el outbox (offline-first).
 * Un compartido con permiso 'ver' abre en solo lectura.
 */
@Component({
  selector: 'app-nota-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, ConfirmDialog],
  templateUrl: './nota-editor.html',
  styleUrl: './nota-editor.scss',
})
export class NotaEditorPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private service = inject(NotasService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  readonly colores = NOTA_COLORES;

  loading = signal(true);
  private id = '';
  private esNueva = false;
  private expectedUpdatedAt: string | null = null;

  esMia = signal(true);
  puedeEditar = signal(true);

  titulo = signal('');
  contenido = signal('');
  color = signal<string | null>(null);
  pinned = signal(false);
  archivada = signal(false);
  private inicial = '';

  guardando = signal(false);
  confirmBorrar = signal(false);

  // ---- Compartir ----
  mostrarCompartir = signal(false);
  compartidos = signal<NotaCompartido[]>([]);
  busqueda = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const param = this.route.snapshot.paramMap.get('id') ?? 'nueva';
      if (param === 'nueva') {
        this.esNueva = true;
        this.id = crypto.randomUUID();
        this.esMia.set(true);
        this.puedeEditar.set(true);
      } else {
        this.id = param;
        const n = await this.service.getNota(param);
        if (n) this.hidratar(n);
      }
      this.inicial = this.snapshot();
    } finally {
      this.loading.set(false);
    }
  }

  private hidratar(n: Nota): void {
    this.titulo.set(n.titulo);
    this.contenido.set(n.contenido);
    this.color.set(n.color);
    this.pinned.set(n.pinned);
    this.archivada.set(n.archivada);
    this.esMia.set(!!n.es_mia);
    this.puedeEditar.set(n.permiso === 'editar');
    this.expectedUpdatedAt = n.updated_at ?? null;
    if (n.es_mia) void this.cargarCompartidos();
  }

  private snapshot(): string {
    return JSON.stringify([
      this.titulo(),
      this.contenido(),
      this.color(),
      this.pinned(),
      this.archivada(),
    ]);
  }
  private dirty(): boolean {
    return this.snapshot() !== this.inicial;
  }

  setColor(c: string | null): void {
    if (this.puedeEditar()) this.color.set(c);
  }
  togglePin(): void {
    if (this.puedeEditar()) this.pinned.update((v) => !v);
  }

  async guardar(volver = true): Promise<void> {
    if (this.guardando()) return;
    if (!this.puedeEditar()) {
      if (volver) this.location.back();
      return;
    }
    // Nada que guardar en una nota nueva totalmente vacía.
    if (this.esNueva && !this.titulo().trim() && !this.contenido().trim()) {
      if (volver) this.location.back();
      return;
    }
    this.guardando.set(true);
    try {
      await this.service.guardar({
        id: this.id,
        titulo: this.titulo().trim(),
        contenido: this.contenido(),
        color: this.color(),
        pinned: this.pinned(),
        archivada: this.archivada(),
        expectedUpdatedAt: this.expectedUpdatedAt,
      });
      this.inicial = this.snapshot();
      this.esNueva = false;
      if (volver) {
        this.toast.success('Nota guardada.');
        this.location.back();
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la nota.');
    } finally {
      this.guardando.set(false);
    }
  }

  async toggleArchivar(): Promise<void> {
    if (!this.puedeEditar()) return;
    this.archivada.update((v) => !v);
    await this.guardar(false);
    this.toast.success(this.archivada() ? 'Nota archivada.' : 'Nota restaurada.');
  }

  pedirBorrar(): void {
    this.confirmBorrar.set(true);
  }
  async confirmarBorrar(): Promise<void> {
    this.confirmBorrar.set(false);
    if (!this.esMia()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para borrar la nota.');
      return;
    }
    try {
      await this.service.eliminar(this.id);
      this.toast.success('Nota borrada.');
      this.location.back();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo borrar la nota.');
    }
  }
  cancelarBorrar(): void {
    this.confirmBorrar.set(false);
  }

  // ---- Compartir -----------------------------------------------------------

  async abrirCompartir(): Promise<void> {
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para compartir.');
      return;
    }
    // La nota debe EXISTIR en el servidor antes de compartirla (FK). El guardado
    // por outbox es asíncrono → aquí se guarda DIRECTO (online) para evitar carrera.
    if (this.puedeEditar() && (this.esNueva || this.dirty())) {
      try {
        await this.service.guardarDirecto({
          id: this.id,
          titulo: this.titulo().trim(),
          contenido: this.contenido(),
          color: this.color(),
          pinned: this.pinned(),
          archivada: this.archivada(),
          expectedUpdatedAt: this.expectedUpdatedAt,
        });
        this.inicial = this.snapshot();
        this.esNueva = false;
      } catch (e) {
        this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar antes de compartir.');
        return;
      }
    }
    this.mostrarCompartir.set(true);
    void this.cargarCompartidos();
  }
  cerrarCompartir(): void {
    this.mostrarCompartir.set(false);
    this.busqueda.set('');
    this.resultados.set([]);
  }

  private async cargarCompartidos(): Promise<void> {
    try {
      this.compartidos.set(await this.service.getCompartidos(this.id));
    } catch {
      /* best-effort */
    }
  }

  async buscar(): Promise<void> {
    const term = this.busqueda().trim();
    if (term.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      const yaCompartidos = new Set(this.compartidos().map((c) => c.usuario_id));
      const res = await this.service.buscarUsuarios(term);
      this.resultados.set(res.filter((u) => !yaCompartidos.has(u.id)));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo buscar.');
    } finally {
      this.buscando.set(false);
    }
  }

  async agregar(u: UsuarioBusqueda, permiso: NotaPermiso): Promise<void> {
    try {
      await this.service.compartir(this.id, u.id, permiso);
      this.busqueda.set('');
      this.resultados.set([]);
      await this.cargarCompartidos();
      this.toast.success(`Compartida con ${u.nombre}.`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo compartir.');
    }
  }

  async cambiarPermiso(c: NotaCompartido, permiso: NotaPermiso): Promise<void> {
    if (c.permiso === permiso) return;
    try {
      await this.service.compartir(this.id, c.usuario_id, permiso);
      await this.cargarCompartidos();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el permiso.');
    }
  }

  async quitar(c: NotaCompartido): Promise<void> {
    try {
      await this.service.quitarCompartido(this.id, c.usuario_id);
      await this.cargarCompartidos();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo quitar el acceso.');
    }
  }

  back(): void {
    // Guarda los cambios pendientes al salir (si puede editar).
    if (this.puedeEditar() && this.dirty()) {
      void this.guardar(true);
    } else {
      this.location.back();
    }
  }
}
