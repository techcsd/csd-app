import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { MarkdownView } from '../../../shared/ui/markdown-view/markdown-view';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { NotasService } from '../../../core/services/notas.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Nota } from '../../../core/models/nota.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { markdownAPlano } from '../../../core/util/markdown';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

type Tab = 'mias' | 'compartidas';

const SGC_WEB = 'https://sgcconstructorasd.com';

/** CQ2 — días (locales, medianoche a medianoche) entre una fecha y hoy. 0 = hoy. */
function diasDesdeHoy(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const hoy = new Date();
  const dIni = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const hoyIni = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Math.round((hoyIni - dIni) / 86_400_000);
}

/**
 * BP5/CQ2 — "Dev notes" (Tecnología): notas técnicas en Markdown (ambito='dev'),
 * personales y compartidas. Gate por rol es_rol_desarrollador (mismo criterio del
 * padre; la RLS ya limita la lectura a Tecnología).
 *
 * CQ2 añade edición real en la app (antes solo lectura con deep-link "Editar en
 * SGC web"): agrupación Hoy/Esta semana/Antes, CTA "Nota nueva" y "Mandar a ronda"
 * (copia en texto plano + marca informativa `enviada_a_ronda_at`).
 */
@Component({
  selector: 'app-dev-notes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, MarkdownView, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './dev-notes.html',
  styleUrl: './dev-notes.scss',
})
export class DevNotesPage {
  private service = inject(NotasService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private location = inject(Location);
  private router = inject(Router);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

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

  /** CQ2 — lista() agrupada por Hoy / Esta semana / Antes (orden preservado, incl. pines). */
  grupos = computed<{ label: string; notas: Nota[] }[]>(() => {
    const hoy: Nota[] = [];
    const semana: Nota[] = [];
    const antes: Nota[] = [];
    for (const n of this.lista()) {
      const dias = diasDesdeHoy(n.updated_at);
      if (dias <= 0) hoy.push(n);
      else if (dias <= 6) semana.push(n);
      else antes.push(n);
    }
    const out: { label: string; notas: Nota[] }[] = [];
    if (hoy.length) out.push({ label: this.i18n.t('Hoy'), notas: hoy });
    if (semana.length) out.push({ label: this.i18n.t('Esta semana'), notas: semana });
    if (antes.length) out.push({ label: this.i18n.t('Antes'), notas: antes });
    return out;
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

  /** CQ2 — acción principal ahora: edición en la app (reemplaza "Editar en SGC web"). */
  editar(n: Nota): void {
    void this.router.navigate(['/tecnologia/dev-notes', n.id]);
  }

  /** CQ2 — "Nota nueva" (CTA naranja, una sola acción destacada por pantalla). */
  nuevaNota(): void {
    void this.router.navigate(['/tecnologia/dev-notes/nueva']);
  }

  /** Deep-link secundario: abre la nota en la web de SGC (respaldo, ya no es la vía principal). */
  abrirEnWeb(n: Nota): void {
    const url = `${SGC_WEB}/tecnologia/dev-notes/${n.id}`;
    window.open(url, '_blank');
  }

  /**
   * CQ2 — "Mandar a ronda": copia el contenido en texto plano (sin símbolos
   * Markdown crudos) y marca `enviada_a_ronda_at` (informativo, best-effort).
   * `ev` puede venir de un botón dentro de una tarjeta de lista — se detiene la
   * propagación para no abrir el lector al mismo tiempo.
   */
  async mandarARonda(n: Nota, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    const texto = markdownAPlano(n.contenido);
    const cuerpo = n.titulo?.trim() ? `${n.titulo.trim()}\n\n${texto}` : texto;
    try {
      await navigator.clipboard.writeText(cuerpo);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar. El navegador bloqueó el portapapeles.'));
      return;
    }
    this.toast.success(this.i18n.t('Copiado. Pega el contenido en la conversación de la ronda.'));
    if (n.es_mia && this.online) {
      try {
        const ts = await this.service.marcarEnviadaARonda(n.id);
        const actualizar = (list: Nota[]) =>
          list.map((x) => (x.id === n.id ? { ...x, enviada_a_ronda_at: ts } : x));
        this.notas.update(actualizar);
        if (this.abierta()?.id === n.id) {
          this.abierta.update((cur) => (cur ? { ...cur, enviada_a_ronda_at: ts } : cur));
        }
      } catch {
        /* no bloquea la copia — es solo informativo */
      }
    }
  }

  back(): void {
    this.location.back();
  }
}
