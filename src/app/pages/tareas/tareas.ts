import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../shared/ui/photo-slot/photo-slot';
import { TareasService, UsuarioBusqueda } from '../../core/services/tareas.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ToastService } from '../../core/services/toast.service';
import { CapturedPhoto } from '../../core/services/camera.service';
import { Tarea, TareaPrioridad, TAREA_ESTADO_META, TAREA_PRIORIDAD_META } from '../../core/models/tarea.model';
import { formatFechaMedia } from '../../core/util/fecha';

/**
 * AF39 — Módulo Tareas en la app. Mis tareas (asignadas a mí o creadas por mí),
 * detalle limpio, avance de estado (iniciar/completar, offline por outbox) y
 * creación para roles con el módulo `tareas`.
 */
@Component({
  selector: 'app-tareas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, OptionButton, PhotoSlot],
  templateUrl: './tareas.html',
  styleUrl: './tareas.scss',
})
export class TareasPage {
  private tareas = inject(TareasService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly fecha = formatFechaMedia;
  readonly estadoMeta = TAREA_ESTADO_META;
  readonly prioridadMeta = TAREA_PRIORIDAD_META;
  readonly prioridades: TareaPrioridad[] = ['baja', 'media', 'alta', 'urgente'];

  loading = signal(true);
  lista = signal<Tarea[]>([]);
  verCompletadas = signal(false);
  activo = signal<Tarea | null>(null);
  hoja = signal<'lista' | 'crear'>('lista');
  submitting = signal(false);

  // Completar
  completando = signal(false);
  justificacion = signal('');
  fotoCompletar = signal<CapturedPhoto | null>(null);

  // Crear
  puedeCrear = computed(() => this.ctx.hasModulo('tareas') || this.ctx.esAdmin());
  nuevoTitulo = signal('');
  nuevoDesc = signal('');
  nuevaPrioridad = signal<TareaPrioridad>('media');
  nuevaFechaLimite = signal('');
  asignBusqueda = signal('');
  asignResultados = signal<UsuarioBusqueda[]>([]);
  asignSel = signal<UsuarioBusqueda | null>(null);
  buscando = signal(false);

  private uid = computed(() => this.ctx.profile()?.id ?? null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.lista.set(await this.tareas.misTareas(this.verCompletadas()));
    } catch {
      this.toast.error('No se pudieron cargar las tareas.');
    } finally {
      this.loading.set(false);
    }
  }

  toggleCompletadas(): void {
    this.verCompletadas.update((v) => !v);
    void this.load();
  }

  esMia(t: Tarea): boolean {
    return t.asignado_a === this.uid();
  }

  abrir(t: Tarea): void {
    this.activo.set(t);
    this.completando.set(false);
    this.justificacion.set('');
    this.fotoCompletar.set(null);
  }
  cerrar(): void {
    this.activo.set(null);
  }

  async iniciar(t: Tarea): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.tareas.iniciar(t.id);
      this.toast.success('Tarea iniciada.');
      this.cerrar();
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo iniciar.');
    } finally {
      this.submitting.set(false);
    }
  }

  pedirCompletar(): void {
    this.completando.set(true);
  }
  onFotoCompletar(p: CapturedPhoto): void {
    this.fotoCompletar.set(p);
  }
  onFotoCompletarCleared(): void {
    this.fotoCompletar.set(null);
  }

  async completar(t: Tarea): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.tareas.completar(t.id, this.justificacion().trim() || null, this.fotoCompletar()?.blob ?? null);
      this.toast.success('Tarea completada.');
      this.cerrar();
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      this.submitting.set(false);
    }
  }

  // ── Crear ──
  abrirCrear(): void {
    this.hoja.set('crear');
  }
  cerrarCrear(): void {
    this.hoja.set('lista');
    this.nuevoTitulo.set('');
    this.nuevoDesc.set('');
    this.nuevaPrioridad.set('media');
    this.nuevaFechaLimite.set('');
    this.asignBusqueda.set('');
    this.asignResultados.set([]);
    this.asignSel.set(null);
  }

  async buscarAsignado(): Promise<void> {
    const term = this.asignBusqueda().trim();
    if (term.length < 2) {
      this.asignResultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      this.asignResultados.set(await this.tareas.buscarUsuarios(term));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }
  pickAsignado(u: UsuarioBusqueda): void {
    this.asignSel.set(u);
    this.asignResultados.set([]);
    this.asignBusqueda.set(u.nombre);
  }

  async crear(): Promise<void> {
    if (this.submitting()) return;
    if (!this.nuevoTitulo().trim()) {
      this.toast.error('Escribe el título de la tarea.');
      return;
    }
    if (!this.asignSel()) {
      this.toast.error('Elige a quién se la asignas.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.tareas.crear({
        titulo: this.nuevoTitulo().trim(),
        descripcion: this.nuevoDesc().trim() || null,
        prioridad: this.nuevaPrioridad(),
        asignadoA: this.asignSel()!.id,
        proyectoId: null,
        fechaLimite: this.nuevaFechaLimite() || null,
      });
      this.toast.success('Tarea creada.');
      this.cerrarCrear();
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la tarea.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    if (this.hoja() === 'crear') {
      this.cerrarCrear();
      return;
    }
    if (this.activo()) {
      this.cerrar();
      return;
    }
    this.location.back();
  }
}
