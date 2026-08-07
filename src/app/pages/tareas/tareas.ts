import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../shared/ui/photo-slot/photo-slot';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../shared/ui/select-list/select-list';
import { TareasService, UsuarioBusqueda } from '../../core/services/tareas.service';
import { InventarioService, ObraOrigen } from '../../core/services/inventario.service';
import { Bodega, Ferreteria } from '../../core/models/inventario.model';
import { UserContextService } from '../../core/services/user-context.service';
import { ToastService } from '../../core/services/toast.service';
import { CapturedPhoto } from '../../core/services/camera.service';
import {
  Tarea,
  TareaPrioridad,
  TareaLinkedTipo,
  TareaLinkedParams,
  TAREA_ESTADO_META,
  TAREA_PRIORIDAD_META,
  TAREA_LINKED_META,
} from '../../core/models/tarea.model';
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
  imports: [FormsModule, Skeleton, EmptyState, OptionButton, PhotoSlot, CollapsibleSelect],
  templateUrl: './tareas.html',
  styleUrl: './tareas.scss',
})
export class TareasPage {
  private tareas = inject(TareasService);
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);

  readonly fecha = formatFechaMedia;
  readonly estadoMeta = TAREA_ESTADO_META;
  readonly prioridadMeta = TAREA_PRIORIDAD_META;
  readonly linkedMeta = TAREA_LINKED_META;
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

  // AG15 — vínculo dinámico al crear la tarea (opcional).
  readonly vinculoTipos: { valor: 'ninguno' | TareaLinkedTipo; label: string }[] = [
    { valor: 'ninguno', label: 'Sin vínculo' },
    { valor: 'conduce', label: '📦 Conduce' },
    { valor: 'ruta', label: '🗺️ Ruta' },
  ];
  nuevoVinculo = signal<'ninguno' | TareaLinkedTipo>('ninguno');
  vincObra = signal(''); // proyecto destino
  vincFerreteria = signal('');
  vincBodega = signal('');
  obrasVinc = signal<ObraOrigen[]>([]);
  ferreteriasVinc = signal<Ferreteria[]>([]);
  bodegasVinc = signal<Bodega[]>([]);
  // AI14 — vínculo por dropdowns estándar (opcionales; primera opción = ninguna).
  ferreteriaVincOptions = computed<SelectOption[]>(() => [
    { id: '', label: '— Ninguna (sale de un almacén) —' },
    ...this.ferreteriasVinc().map((f) => ({ id: f.id, label: f.nombre })),
  ]);
  bodegaVincOptions = computed<SelectOption[]>(() => [
    { id: '', label: '— Sin especificar —' },
    ...this.bodegasVinc().map((b) => ({ id: b.id, label: b.nombre })),
  ]);
  obraVincOptions = computed<SelectOption[]>(() => [
    { id: '', label: '— Sin especificar —' },
    ...this.obrasVinc().map((o) => ({ id: o.id, label: o.nombre })),
  ]);
  private catalogosVincCargados = false;
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

  /**
   * AG15 — ¿esta tarea abre un flujo del sistema al iniciar? (v1: conduce con
   * deep-link + auto-completado al confirmar la entrega). Se muestra el CTA
   * "Iniciar y crear…" en el detalle.
   */
  puedeAbrirFlujo(t: Tarea | null): boolean {
    if (!t || t.estado === 'completada' || t.estado === 'cancelada') return false;
    if (t.linked_tipo === 'conduce' || t.linked_tipo === 'ruta') return true;
    // Mantenimiento necesita el vehículo en los params para deep-linkear al wizard.
    if (t.linked_tipo === 'mantenimiento') return !!t.linked_params?.vehiculo_id;
    return false;
  }

  /**
   * AG15 — inicia la tarea vinculada y abre el flujo correspondiente pre-llenado
   * (deep-link). El flujo, al crear la entidad, la enlaza a la tarea; al confirmarse
   * (entrega del conduce) la tarea se completa sola y notifica al asignador.
   */
  async iniciarYAbrir(t: Tarea): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.tareas.iniciar(t.id);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo iniciar.');
      this.submitting.set(false);
      return;
    }
    this.submitting.set(false);
    this.cerrar();
    const p = t.linked_params ?? {};
    if (t.linked_tipo === 'conduce') {
      const queryParams: Record<string, string> = { tarea: t.id, origen: p.origen_tipo ?? 'almacen' };
      if (p.bodega_id) queryParams['bodega'] = p.bodega_id;
      if (p.ferreteria_id) queryParams['ferreteria'] = p.ferreteria_id;
      if (p.obra_id) queryParams['obra'] = p.obra_id;
      void this.router.navigate(['/transporte/generar-conduce'], { queryParams });
    } else if (t.linked_tipo === 'ruta') {
      void this.router.navigate(['/transporte/rutas/crear'], { queryParams: { tarea: t.id } });
    } else if (t.linked_tipo === 'mantenimiento' && p.vehiculo_id) {
      void this.router.navigate(['/transporte/mantenimiento', p.vehiculo_id], {
        queryParams: { tarea: t.id },
      });
    } else {
      await this.load();
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
    void this.cargarCatalogosVinculo();
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
    this.nuevoVinculo.set('ninguno');
    this.vincObra.set('');
    this.vincFerreteria.set('');
    this.vincBodega.set('');
  }

  /** AG15 — carga (una vez) los catálogos para armar el vínculo de la tarea. */
  private async cargarCatalogosVinculo(): Promise<void> {
    if (this.catalogosVincCargados) return;
    this.catalogosVincCargados = true;
    const [obras, ferr, bodegas] = await Promise.all([
      this.inventario.getObrasConBodega().catch(() => [] as ObraOrigen[]),
      this.inventario.getFerreterias().catch(() => [] as Ferreteria[]),
      this.inventario.getBodegas().catch(() => [] as Bodega[]),
    ]);
    this.obrasVinc.set(obras);
    this.ferreteriasVinc.set(ferr);
    this.bodegasVinc.set(bodegas);
  }

  setVinculo(v: 'ninguno' | TareaLinkedTipo): void {
    this.nuevoVinculo.set(v);
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
    // AG15 — arma el vínculo si se eligió uno.
    let linkedTipo: TareaLinkedTipo | null = null;
    let linkedParams: TareaLinkedParams | null = null;
    if (this.nuevoVinculo() === 'conduce') {
      linkedTipo = 'conduce';
      linkedParams = {
        origen_tipo: this.vincFerreteria() ? 'ferreteria' : 'almacen',
        ...(this.vincFerreteria() ? { ferreteria_id: this.vincFerreteria() } : {}),
        ...(this.vincBodega() ? { bodega_id: this.vincBodega() } : {}),
        ...(this.vincObra() ? { obra_id: this.vincObra() } : {}),
      };
    } else if (this.nuevoVinculo() === 'ruta') {
      linkedTipo = 'ruta';
      linkedParams = {};
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
        linkedTipo,
        linkedParams,
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
