import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';
import { NotasService } from '../../../../core/services/notas.service';
import { ToastService } from '../../../../core/services/toast.service';
import { NetworkService } from '../../../../core/services/network.service';
import { UserContextService } from '../../../../core/services/user-context.service';
import { Nota } from '../../../../core/models/nota.model';
import { formatFechaCortaHora } from '../../../../core/util/fecha';
import { htmlToMarkdown, markdownAPlano, markdownToHtml, resolverImagenesNota } from '../../../../core/util/markdown';

const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * CQ2 — editor de Dev notes ESCRIBIBLE (antes solo lectura, "Editar en SGC web").
 * Mismo patrón que `nota-editor.ts` (contenteditable + toolbar execCommand,
 * autoguardado por el outbox), pero el contenido canónico es MARKDOWN PLANO
 * (igual que la web): el cuerpo enriquecido es solo una VISTA — cada cambio se
 * serializa de vuelta a Markdown (`htmlToMarkdown`) antes de guardarse, y al abrir
 * una nota existente el Markdown se hidrata a HTML (`markdownToHtml`, vía `marked`)
 * para mostrarse con formato real en vez de símbolos crudos.
 *
 * "Texto simple" cambia a un <textarea> atado directo al Markdown (sin conversión:
 * lo que se ve ES lo que se guarda) — red de seguridad para estructuras que el
 * conversor HTML→MD no cubre (código, tablas, citas; ver `core/util/markdown.ts`).
 *
 * Pantalla completa: página ruteada normal con `.screen { height: 100dvh }` (no
 * hay chrome persistente fuera de `<router-outlet>` en app.html) — el mismo patrón
 * que ya usa `/notas/:id`.
 */
@Component({
  selector: 'app-dev-nota-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './dev-nota-editor.html',
  styleUrl: './dev-nota-editor.scss',
})
export class DevNotaEditorPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private service = inject(NotasService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private i18n = inject(I18nService);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  private id = '';
  private esNueva = false;
  private expectedUpdatedAt: string | null = null;

  esMia = signal(true);
  puedeEditar = signal(true);

  titulo = signal('');
  /** Markdown plano — SIEMPRE la fuente de verdad, edite el usuario en modo rico o simple. */
  contenido = signal('');
  pinned = signal(false);
  private baseline = '';

  /** "Texto simple": textarea cruda atada directo al Markdown. */
  modoSimple = signal(false);

  guardando = signal(false);
  guardadoEn = signal<number | null>(null);
  enviadaARondaAt = signal<string | null>(null);
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tick = signal(0);

  /** "Guardado hace Xs" — solo UI, no dispara guardados (eso lo hace el debounce). */
  guardadoTexto = computed<string>(() => {
    this.tick();
    const t = this.guardadoEn();
    if (t === null) return '';
    const segs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (segs < 2) return this.i18n.t('Guardado');
    if (segs < 60) return this.i18n.t('Guardado hace {s}s', { s: segs });
    const mins = Math.floor(segs / 60);
    if (mins < 60) return this.i18n.t('Guardado hace {m} min', { m: mins });
    return this.i18n.t('Guardado hace {h} h', { h: Math.floor(mins / 60) });
  });

  // Cuerpo enriquecido (contenteditable) — se rehidrata cada vez que el elemento
  // cambia (incl. al volver de "Texto simple", donde Angular lo recrea con @if).
  private bodyEl = viewChild<ElementRef<HTMLElement>>('bodyRef');
  private lastBodyEl: HTMLElement | null = null;

  constructor() {
    // CQ2 — gate por rol (espeja la lista: BX1 esDesarrollador, no esTecnologia).
    if (!this.ctx.esDesarrollador()) {
      void this.router.navigate(['/tecnologia/dev-notes'], { replaceUrl: true });
      return;
    }
    void this.load();

    effect(() => {
      const el = this.bodyEl()?.nativeElement ?? null;
      if (el && el !== this.lastBodyEl && !this.loading() && !this.modoSimple()) {
        el.innerHTML = markdownToHtml(this.contenido());
        this.lastBodyEl = el;
        // CS2 — `el.innerHTML` ya es DOM real (escritura directa, no binding de
        // Angular): las imágenes `nota-img:` ya están ahí, listas para resolver.
        void resolverImagenesNota(el, (path) => this.service.resolverImagenUrl(path));
      }
      if (!el) this.lastBodyEl = null;
    });
  }

  ngOnDestroy(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.tickInterval) clearInterval(this.tickInterval);
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
        if (!n || n.ambito !== 'dev') {
          // No existe / no es una dev note — vuelve a la lista en vez de romperse.
          void this.router.navigate(['/tecnologia/dev-notes'], { replaceUrl: true });
          return;
        }
        this.hidratar(n);
      }
      this.baseline = this.snapshot();
    } finally {
      this.loading.set(false);
      this.tickInterval = setInterval(() => this.tick.update((v) => v + 1), 1000);
    }
  }

  private hidratar(n: Nota): void {
    this.titulo.set(n.titulo);
    this.contenido.set(n.contenido);
    this.pinned.set(n.pinned);
    this.esMia.set(!!n.es_mia);
    this.puedeEditar.set(n.permiso === 'editar');
    this.expectedUpdatedAt = n.updated_at ?? null;
    this.enviadaARondaAt.set(n.enviada_a_ronda_at ?? null);
  }

  private snapshot(): string {
    return JSON.stringify([this.titulo(), this.contenido(), this.pinned()]);
  }
  private dirty(): boolean {
    return this.snapshot() !== this.baseline;
  }

  // ---- Edición ---------------------------------------------------------------

  onTitulo(v: string): void {
    this.titulo.set(v);
    this.scheduleAutosave();
  }

  onBodyInput(el: HTMLElement): void {
    this.contenido.set(htmlToMarkdown(el.innerHTML));
    this.scheduleAutosave();
  }

  onSimpleInput(v: string): void {
    this.contenido.set(v);
    this.scheduleAutosave();
  }

  private exec(cmd: string, val?: string): void {
    const el = this.bodyEl()?.nativeElement;
    if (!el || !this.puedeEditar()) return;
    el.focus();
    // execCommand está deprecado pero es la vía soportada en el WebView de Android/iOS
    // (mismo patrón que `nota-editor.ts`).
    document.execCommand(cmd, false, val);
    this.onBodyInput(el);
  }
  cmdBold(): void {
    this.exec('bold');
  }
  cmdItalic(): void {
    this.exec('italic');
  }
  cmdTituloH3(): void {
    this.exec('formatBlock', 'H3');
  }
  cmdVineta(): void {
    this.exec('insertUnorderedList');
  }
  cmdNumerada(): void {
    this.exec('insertOrderedList');
  }

  togglePin(): void {
    if (!this.puedeEditar()) return;
    this.pinned.update((v) => !v);
    this.scheduleAutosave();
  }

  toggleModoSimple(): void {
    this.modoSimple.update((v) => !v);
  }

  // ---- Autoguardado (2s de inactividad, por el outbox — offline-safe) --------

  private scheduleAutosave(): void {
    if (!this.puedeEditar()) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.autoguardar(), AUTOSAVE_DEBOUNCE_MS);
  }

  private async autoguardar(): Promise<void> {
    if (!this.puedeEditar() || !this.dirty()) return;
    // Nada que guardar en una nota nueva totalmente vacía.
    if (this.esNueva && !this.titulo().trim() && !this.contenido().trim()) return;
    this.guardando.set(true);
    try {
      await this.service.guardar({
        id: this.id,
        titulo: this.titulo().trim(),
        contenido: this.contenido(),
        color: null,
        pinned: this.pinned(),
        archivada: false,
        expectedUpdatedAt: this.expectedUpdatedAt,
        ambito: 'dev',
        formato: 'markdown',
      });
      this.esNueva = false;
      this.baseline = this.snapshot();
      this.guardadoEn.set(Date.now());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la nota.'));
    } finally {
      this.guardando.set(false);
    }
  }

  // ---- "Mandar a ronda": copia en texto plano + marca informativa ------------

  async mandarARonda(): Promise<void> {
    const texto = markdownAPlano(this.contenido());
    const cuerpo = this.titulo().trim() ? `${this.titulo().trim()}\n\n${texto}` : texto;
    try {
      await navigator.clipboard.writeText(cuerpo);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar. El navegador bloqueó el portapapeles.'));
      return;
    }
    this.toast.success(this.i18n.t('Copiado. Pega el contenido en la conversación de la ronda.'));
    if (this.puedeEditar() && !this.esNueva && this.network.online()) {
      try {
        const ts = await this.service.marcarEnviadaARonda(this.id);
        this.enviadaARondaAt.set(ts);
      } catch {
        /* no bloquea la copia — es solo informativo */
      }
    }
  }

  // ---- Navegación --------------------------------------------------------------

  back(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (this.puedeEditar() && this.dirty()) {
      void this.autoguardar().finally(() => this.location.back());
    } else {
      this.location.back();
    }
  }
}
