import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { MarkdownView } from '../../../shared/ui/markdown-view/markdown-view';
import { NotasService } from '../../../core/services/notas.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Nota } from '../../../core/models/nota.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';

type Tab = 'mias' | 'compartidas';

const SGC_WEB = 'https://sgcconstructorasd.com';

/**
 * BP5 — "Dev notes" (Tecnología): lectura de las notas técnicas en Markdown
 * (ambito='dev'), personales y compartidas. Gate por rol es_tecnologia() (mismo
 * criterio del padre; la RLS ya limita la lectura a Tecnología). SOLO LECTURA en
 * la app esta tanda: escribir/editar es en la web (deep-link "Editar en SGC web").
 */
@Component({
  selector: 'app-dev-notes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, MarkdownView],
  templateUrl: './dev-notes.html',
  styleUrl: './dev-notes.scss',
})
export class DevNotesPage {
  private service = inject(NotasService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private location = inject(Location);
  private router = inject(Router);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  private notas = signal<Nota[]>([]);
  tab = signal<Tab>('mias');
  busqueda = signal('');
  tagFiltro = signal<string | null>(null);
  abierta = signal<Nota | null>(null);

  constructor() {
    // BX1 — Gate cliente = es_rol_desarrollador (la RLS de notas ambito='dev' lo
    // respalda): admin/tecnología/encargado/Developer. NO gerencia/direccion (verían
    // una lista vacía). Antes era esTecnologia, que excluía al Developer y al encargado.
    if (!this.ctx.esDesarrollador()) {
      void this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }
    void this.load();
  }

  get online(): boolean {
    return this.network.online();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const all = await this.service.getNotas();
      this.notas.set(all.filter((n) => n.ambito === 'dev'));
    } finally {
      this.loading.set(false);
    }
  }

  tagsDisponibles = computed(() => {
    const set = new Set<string>();
    for (const n of this.notas()) (n.tags ?? []).forEach((t) => set.add(t));
    return [...set].sort();
  });

  lista = computed<Nota[]>(() => {
    const q = this.busqueda().trim().toLowerCase();
    const mias = this.tab() === 'mias';
    const tag = this.tagFiltro();
    return this.notas()
      .filter((n) => (mias ? n.es_mia : n.compartida))
      .filter((n) => !n.archivada)
      .filter((n) => !tag || (n.tags ?? []).includes(tag))
      .filter((n) => !q || (n.titulo + ' ' + n.contenido).toLowerCase().includes(q))
      .sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''),
      );
  });

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  toggleTag(t: string): void {
    this.tagFiltro.update((cur) => (cur === t ? null : t));
  }

  abrir(n: Nota): void {
    this.abierta.set(n);
  }
  cerrar(): void {
    this.abierta.set(null);
  }

  /** BP5 — abre la nota en la web de SGC para editarla (sin editor en la app). */
  editarEnWeb(n: Nota): void {
    const url = `${SGC_WEB}/tecnologia/dev-notes/${n.id}`;
    window.open(url, '_blank');
  }

  back(): void {
    this.location.back();
  }
}
