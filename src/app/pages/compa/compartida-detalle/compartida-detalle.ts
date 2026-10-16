import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { MarkdownView } from '../../../shared/ui/markdown-view/markdown-view';
import { CompaService } from '../../../core/services/compa.service';
import { CompaMensajeCompartido } from '../../../core/models/compa.model';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { formatHora } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

interface EstadoNav {
  titulo?: string | null;
  compartida_por_nombre?: string | null;
}

/**
 * CP2 — vista de SOLO LECTURA de una conversación que alguien compartió conmigo.
 * `compa_conversacion_compartida` no devuelve `propuesta` en ningún mensaje
 * (contrato del RPC), así que no hay nada que confirmar/ejecutar desde aquí —
 * la hoja de confirmación de Compa simplemente no existe en esta pantalla.
 */
@Component({
  selector: 'app-compa-compartida-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, MarkdownView, TranslatePipe],
  templateUrl: './compartida-detalle.html',
  styleUrl: './compartida-detalle.scss',
})
export class CompaCompartidaDetallePage {
  private compa = inject(CompaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly fmtHora = formatHora;

  private shareId = this.route.snapshot.paramMap.get('id') ?? '';
  private estadoNav = (history.state ?? {}) as EstadoNav;

  titulo = signal(this.estadoNav.titulo ?? '');
  compartidaPor = signal(this.estadoNav.compartida_por_nombre ?? '');

  loading = signal(true);
  error = signal('');
  mensajes = signal<CompaMensajeCompartido[]>([]);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.mensajes.set(await this.compa.conversacionCompartida(this.shareId));
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo cargar esta conversación.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** "Seguir en una conversación mía" — abre Compa con el contexto precargado en el composer. */
  seguir(): void {
    const ultimos = this.mensajes().slice(-2);
    const fragmento = ultimos.map((m) => `${m.rol === 'user' ? this.i18n.t('Yo') : 'Compa'}: ${m.contenido}`).join('\n');
    const texto = this.i18n.t('Retomando esta conversación que me compartieron:\n{f}\n\n', { f: fragmento });
    void this.router.navigate(['/compa'], { queryParams: { q: texto } });
  }

  back(): void {
    this.location.back();
  }
}
