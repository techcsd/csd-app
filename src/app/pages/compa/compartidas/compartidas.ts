import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CompaService } from '../../../core/services/compa.service';
import { CompaCompartida } from '../../../core/models/compa.model';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { formatFechaRelativa } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * CP2 — "Compartidas conmigo": lo que otros compartieron de sus conversaciones
 * con Compa. Si llega `?conversacion=<id>` (deep-link de la notificación
 * `compa_compartida`, que carga la conversación — NO el share — porque así la
 * manda `notificar_usuarios`), resolvemos el share correspondiente al usuario
 * actual y saltamos directo a su detalle.
 */
@Component({
  selector: 'app-compa-compartidas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe],
  templateUrl: './compartidas.html',
  styleUrl: './compartidas.scss',
})
export class CompaCompartidasPage {
  private compa = inject(CompaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly fmtFecha = formatFechaRelativa;

  loading = signal(true);
  error = signal('');
  compartidas = signal<CompaCompartida[]>([]);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const lista = await this.compa.compartidasConmigo();
      this.compartidas.set(lista);
      // Deep-link desde la notificación: trae el conversacion_id, no el share id.
      const conv = this.route.snapshot.queryParamMap.get('conversacion');
      if (conv) {
        const match = lista.find((c) => c.conversacion_id === conv);
        if (match) this.abrir(match, true);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudieron cargar las conversaciones compartidas.'));
    } finally {
      this.loading.set(false);
    }
  }

  abrir(c: CompaCompartida, replaceUrl = false): void {
    void this.router.navigate(['/compa/compartidas', c.id], {
      replaceUrl,
      state: { titulo: c.titulo, compartida_por_nombre: c.compartida_por_nombre },
    });
  }

  back(): void {
    this.location.back();
  }
}
