import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { NotasService } from '../../core/services/notas.service';
import { SyncService } from '../../core/sync/sync.service';
import { Nota } from '../../core/models/nota.model';
import { formatFechaCortaHora } from '../../core/util/fecha';

type Tab = 'mias' | 'compartidas';

/**
 * AC4 — Notas: listado con pestañas (Mis notas / Compartidas conmigo), búsqueda
 * y orden por última edición (fijadas arriba). Módulo general (todos los roles).
 */
@Component({
  selector: 'app-notas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, SyncBar],
  templateUrl: './notas.html',
  styleUrl: './notas.scss',
})
export class NotasPage {
  private service = inject(NotasService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private location = inject(Location);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  notas = signal<Nota[]>([]);
  tab = signal<Tab>('mias');
  busqueda = signal('');
  verArchivadas = signal(false);

  constructor() {
    void this.load();
    // Refrescar al drenar el outbox (una nota offline pasa a confirmada).
    effect(() => {
      this.sync.changed();
      void this.refresh();
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.notas.set(await this.service.getNotas());
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    this.notas.set(await this.service.getNotas());
  }

  filtradas = computed<Nota[]>(() => {
    const q = this.busqueda().trim().toLowerCase();
    const arch = this.verArchivadas();
    const mias = this.tab() === 'mias';
    return this.notas().filter((n) => {
      if (mias ? !n.es_mia : !n.compartida) return false;
      if (!!n.archivada !== arch) return false;
      if (!q) return true;
      return (n.titulo + ' ' + n.contenido).toLowerCase().includes(q);
    });
  });

  hayArchivadasMias = computed(() =>
    this.notas().some((n) => n.es_mia && n.archivada),
  );

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  abrir(n: Nota): void {
    void this.router.navigate(['/notas', n.id]);
  }

  nueva(): void {
    void this.router.navigate(['/notas', 'nueva']);
  }

  /** Primeras líneas del contenido para el snippet (AD9 — el cuerpo puede ser HTML). */
  snippet(n: Nota): string {
    const raw = n.contenido || '';
    const texto = /<[a-z][\s\S]*>/i.test(raw)
      ? new DOMParser().parseFromString(raw, 'text/html').body.textContent || ''
      : raw;
    return texto.replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  back(): void {
    this.location.back();
  }
}
