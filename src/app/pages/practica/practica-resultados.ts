import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { PracticaService } from '../../core/practica/practica.service';
import { PracticaIntentoFila } from '../../core/practica/practica.models';
import { misionPorId } from '../../core/practica/misiones-app';
import { formatFechaHumana } from '../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/**
 * CM7 (PROMPT-95 F6a) — "Mis resultados": los intentos de práctica del usuario
 * (lo suyo; el panel de jefes es web). Lee `practica_resultados_persona`.
 */
@Component({
  selector: 'app-practica-resultados',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './practica-resultados.html',
  styleUrl: './practica-resultados.scss',
})
export class PracticaResultadosPage {
  private practica = inject(PracticaService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly fmtFecha = formatFechaHumana;

  loading = signal(true);
  intentos = signal<PracticaIntentoFila[]>([]);

  /** Mejor nota por misión (resumen de arriba). */
  resumen = computed(() => {
    const porMision = new Map<string, number>();
    for (const i of this.intentos()) {
      porMision.set(i.mision_id, Math.max(porMision.get(i.mision_id) ?? 0, i.nota));
    }
    return [...porMision.entries()].map(([id, mejor]) => ({ id, titulo: this.tituloMision(id), mejor }));
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.intentos.set(await this.practica.misResultados());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No pudimos cargar tus resultados.'));
    } finally {
      this.loading.set(false);
    }
  }

  tituloMision(id: string): string {
    return misionPorId(id)?.titulo ?? id;
  }

  estrellasTexto(n: number): string {
    return '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 3 - n));
  }

  back(): void {
    this.location.back();
  }
}
