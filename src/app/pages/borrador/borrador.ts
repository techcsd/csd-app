import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ClaudeConectorService } from '../../core/services/claude-conector.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { MOTION_DIRECTIVES } from '../../shared/motion';
import { ClaudeBorrador, ClaudeBorradorDetalleLinea } from '../../core/models/claude-conector.model';
import { formatFechaRelativa } from '../../core/util/fecha';

/** Título legible por `tool` (igual mapeo que `borrador-claude.ts` de la web, AU1). */
const TITULO_POR_TOOL: Record<string, string> = {
  proponer_tarea: 'Borrador de tarea',
  proponer_requisicion: 'Borrador de requisición',
  proponer_conduce: 'Borrador de conduce',
  proponer_ruta: 'Borrador de ruta de transporte',
};
/** "Editar antes de crear" → el formulario normal de la app para ese tipo. Mismo
 *  honesto sin-pre-llenado que la web (las params del borrador no se traducen a
 *  estado de formulario en ningún lado todavía — follow-up documentado). */
const RUTA_EDITAR_POR_TOOL: Record<string, string> = {
  proponer_tarea: '/tareas',
  proponer_requisicion: '/solicitudes/pedir',
  proponer_conduce: '/transporte/generar-conduce',
  proponer_ruta: '/transporte/rutas/crear',
};

/**
 * CR1 (PROMPT-105 F1) — `/borrador/:id`. Adaptado a una columna de 390 px del mock
 * web `Borrador-claude.dc.html` (OK de Xaviel: mocks van tal cual, columna única
 * para el teléfono). Un solo camino de ejecución (AU1): confirmar llama la MISMA
 * edge `claude-borrador` que usa la web — confirmar dos veces nunca duplica.
 * Online-only: no pasa por el outbox, es una confirmación puntual.
 */
@Component({
  selector: 'app-borrador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, EmptyState, ...MOTION_DIRECTIVES],
  templateUrl: './borrador.html',
  styleUrl: './borrador.scss',
})
export class BorradorPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private claude = inject(ClaudeConectorService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private location = inject(Location);

  private id = this.route.snapshot.paramMap.get('id') ?? '';

  cargando = signal(true);
  error = signal<string | null>(null);
  borrador = signal<ClaudeBorrador | null>(null);
  detalle = signal<ClaudeBorradorDetalleLinea[]>([]);
  enviando = signal(false);
  resultado = signal<{ ok?: boolean; mensaje?: string; duplicado?: boolean } | null>(null);

  titulo = computed(() => this.i18n.t(TITULO_POR_TOOL[this.borrador()?.tool ?? ''] ?? 'Borrador'));
  fmtRelativa = formatFechaRelativa;

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const { borrador, detalle } = await this.claude.obtenerBorrador(this.id);
      this.borrador.set(borrador);
      this.detalle.set(detalle ?? []);
      this.resultado.set(borrador.resultado ?? null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar el borrador.'));
    } finally {
      this.cargando.set(false);
    }
  }

  recargar(): void {
    void this.cargar();
  }

  /** Minutos/horas legibles hasta `expira_en` (CR1 §B3: 24 h desde que se creó). */
  tiempoRestante(): string {
    const b = this.borrador();
    if (!b) return '';
    const min = Math.max(0, Math.round((new Date(b.expira_en).getTime() - Date.now()) / 60_000));
    return min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;
  }

  async confirmar(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      const data = await this.claude.confirmar(this.id);
      this.resultado.set(data);
      if (data.ok) {
        await this.cargar();
        this.toast.success(data.duplicado ? this.i18n.t('Ya estaba confirmado.') : this.i18n.t('Creado correctamente.'));
      } else {
        this.toast.error(data.mensaje || this.i18n.t('No se pudo completar.'));
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo confirmar el borrador.'));
    } finally {
      this.enviando.set(false);
    }
  }

  async descartar(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.claude.descartar(this.id);
      await this.cargar();
      this.toast.success(this.i18n.t('Borrador descartado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo descartar el borrador.'));
    } finally {
      this.enviando.set(false);
    }
  }

  /** Descarta (best-effort) y abre el formulario normal de la app para ese tipo. */
  async editarAntesDeCrear(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.claude.descartar(this.id);
    } catch {
      /* best-effort: igual navegamos al formulario normal */
    } finally {
      this.enviando.set(false);
    }
    const ruta = RUTA_EDITAR_POR_TOOL[this.borrador()?.tool ?? ''] ?? '/home';
    void this.router.navigateByUrl(ruta);
  }

  back(): void {
    this.location.back();
  }
}
