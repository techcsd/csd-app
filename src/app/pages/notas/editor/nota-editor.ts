import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
  NotaChecklistItem,
  NotaCompartido,
  NotaPermiso,
  NOTA_COLORES,
  UsuarioBusqueda,
} from '../../../core/models/nota.model';

// AD9 — saneado del cuerpo HTML (una nota compartida puede traer HTML ajeno).
// Se aplica ANTES de inyectarlo en el contenteditable (elementos detached no
// ejecutan scripts ni cargan <img>), dejando solo formato básico sin atributos.
const TAGS_PERMITIDAS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN',
]);
function sanitizeNoteHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html ?? '';
  const walk = (node: Element): void => {
    [...node.children].forEach((el) => {
      if (!TAGS_PERMITIDAS.has(el.tagName)) {
        el.replaceWith(document.createTextNode(el.textContent ?? ''));
        return;
      }
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      walk(el);
    });
  };
  walk(div);
  return div.innerHTML;
}
function esHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s ?? '');
}
function plainToHtml(s: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(s ?? '').replace(/\n/g, '<br>');
}

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

  // ---- Checklist estructurado (AD9) ----
  checklist = signal<NotaChecklistItem[]>([]);
  private focoItemId: string | null = null;

  // Cuerpo enriquecido (contenteditable) — se hidrata una sola vez.
  private bodyEl = viewChild<ElementRef<HTMLElement>>('bodyRef');
  private bodyHidratado = false;

  // ---- Compartir ----
  mostrarCompartir = signal(false);
  compartidos = signal<NotaCompartido[]>([]);
  busqueda = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);

  constructor() {
    void this.load();
    // Inyecta el HTML en el editor cuando el elemento existe (tras loading()).
    effect(() => {
      const el = this.bodyEl()?.nativeElement;
      if (el && !this.bodyHidratado && !this.loading()) {
        el.innerHTML = this.renderBody(this.contenido());
        this.bodyHidratado = true;
      }
    });
  }

  private renderBody(raw: string): string {
    return esHtml(raw) ? sanitizeNoteHtml(raw) : plainToHtml(raw);
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
        // Red de seguridad: alinea los checks vinculados con su tarea antes de leer.
        await this.service.reconciliarChecklist(param);
        const n = await this.service.getNota(param);
        if (n) this.hidratar(n);
        this.checklist.set(await this.service.getChecklist(param));
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
      this.checklist().map((i) => [i.id, i.orden, i.texto, i.done]),
    ]);
  }
  private dirty(): boolean {
    return this.snapshot() !== this.inicial;
  }

  private textoPlano(html: string): string {
    const d = document.createElement('div');
    d.innerHTML = html ?? '';
    return (d.textContent ?? '').trim();
  }

  setColor(c: string | null): void {
    if (this.puedeEditar()) this.color.set(c);
  }
  togglePin(): void {
    if (this.puedeEditar()) this.pinned.update((v) => !v);
  }

  // ---- Cuerpo enriquecido: toolbar por botones (sin sintaxis manual) --------

  onBodyInput(el: HTMLElement): void {
    this.contenido.set(el.innerHTML);
  }
  private exec(cmd: string, val?: string): void {
    const el = this.bodyEl()?.nativeElement;
    if (!el || !this.puedeEditar()) return;
    el.focus();
    // execCommand está deprecado pero es la vía soportada en el WebView de Android/iOS.
    document.execCommand(cmd, false, val);
    this.contenido.set(el.innerHTML);
  }
  cmdBold(): void {
    this.exec('bold');
  }
  cmdItalic(): void {
    this.exec('italic');
  }
  // AE4 — subrayado (espeja la toolbar web AD9; 'U' está en TAGS_PERMITIDAS).
  cmdSubrayado(): void {
    this.exec('underline');
  }
  cmdTitulo(): void {
    this.exec('formatBlock', 'H3');
  }
  cmdVineta(): void {
    this.exec('insertUnorderedList');
  }
  // AE4 — lista numerada (espeja la toolbar web AD9; 'OL' está en TAGS_PERMITIDAS).
  cmdNumerada(): void {
    this.exec('insertOrderedList');
  }

  // ---- Checklist (AD9): táctil, agregar con Enter, reordenar ----------------

  /** Solo los ítems manuales (los vinculados a una tarea los maneja el servidor). */
  private manuales(): NotaChecklistItem[] {
    return this.checklist().filter((i) => !i.ref_tipo);
  }

  agregarItem(despuesDe?: number): void {
    if (!this.puedeEditar()) return;
    const items = [...this.checklist()];
    const nuevo: NotaChecklistItem = {
      id: crypto.randomUUID(),
      nota_id: this.id,
      orden: 0,
      texto: '',
      done: false,
      done_auto: false,
      ref_tipo: null,
      ref_id: null,
    };
    const pos = despuesDe != null ? despuesDe + 1 : items.length;
    items.splice(pos, 0, nuevo);
    this.renumerar(items);
    this.checklist.set(items);
    this.enfocar(nuevo.id);
  }

  toggleItem(item: NotaChecklistItem): void {
    if (!this.puedeEditar() || item.ref_tipo) return; // los vinculados son solo lectura
    this.checklist.update((items) =>
      items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
    );
  }

  setItemTexto(item: NotaChecklistItem, texto: string): void {
    this.checklist.update((items) =>
      items.map((i) => (i.id === item.id ? { ...i, texto } : i)),
    );
  }

  quitarItem(item: NotaChecklistItem): void {
    if (!this.puedeEditar() || item.ref_tipo) return;
    const items = this.checklist().filter((i) => i.id !== item.id);
    this.renumerar(items);
    this.checklist.set(items);
  }

  moverItem(index: number, dir: -1 | 1): void {
    if (!this.puedeEditar()) return;
    const items = [...this.checklist()];
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    this.renumerar(items);
    this.checklist.set(items);
  }

  onItemEnter(index: number): void {
    this.agregarItem(index);
  }

  private renumerar(items: NotaChecklistItem[]): void {
    items.forEach((i, idx) => (i.orden = idx));
  }

  private enfocar(id: string): void {
    this.focoItemId = id;
    setTimeout(() => {
      if (this.focoItemId !== id) return;
      document.getElementById(`chk-${id}`)?.focus();
      this.focoItemId = null;
    }, 0);
  }

  async guardar(volver = true): Promise<void> {
    if (this.guardando()) return;
    if (!this.puedeEditar()) {
      if (volver) this.location.back();
      return;
    }
    // Nada que guardar en una nota nueva totalmente vacía (ni cuerpo ni checklist).
    if (
      this.esNueva &&
      !this.titulo().trim() &&
      !this.textoPlano(this.contenido()) &&
      !this.manuales().length
    ) {
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
      await this.persistirChecklist();
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

  /** Enqueue los ítems manuales del checklist (reemplazo idempotente). */
  private async persistirChecklist(): Promise<void> {
    const items = this.manuales().map((i) => ({
      id: i.id,
      orden: i.orden,
      texto: i.texto.trim(),
      done: i.done,
    }));
    await this.service.guardarChecklist(this.id, items);
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
        // La nota ya existe en el servidor → el checklist puede persistir (FK ok).
        await this.persistirChecklist();
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
