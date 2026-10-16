import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PlantillasDocumentoService } from '../../../core/services/plantillas-documento.service';
import { PlantillaDocumento } from '../../../core/models/plantilla-documento.model';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const CATEGORIA_LABEL: Record<string, string> = {
  contrato: 'Contrato',
  recibo_pago: 'Recibo de pago',
  orden_pago: 'Orden de pago',
  carta_entrega: 'Carta de entrega',
  acta_incidencia: 'Acta de incidencia',
  otro: 'Otro',
};

/**
 * CO12 — Plantillas (solo ver + vista previa + marcar la que se usa). Editar
 * sigue siendo SOLO en la web (editor TipTap) — aquí solo se explica dónde.
 */
@Component({
  selector: 'app-documentos-plantillas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './plantillas.html',
  styleUrl: './plantillas.scss',
})
export class DocumentosPlantillasPage {
  private plantillasSvc = inject(PlantillasDocumentoService);
  private sanitizer = inject(DomSanitizer);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  categoriaLabel = (c: string): string => CATEGORIA_LABEL[c] ?? c;

  loading = signal(true);
  lista = signal<PlantillaDocumento[]>([]);
  marcando = signal<string | null>(null);

  abierta = signal<PlantillaDocumento | null>(null);
  htmlPreview = signal<SafeHtml>('');

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.lista.set(await this.plantillasSvc.getAll());
    } catch {
      this.lista.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Vista previa con datos de ejemplo (lo naranja se llena solo — aquí, texto de marcador). */
  ver(p: PlantillaDocumento): void {
    const ejemplo: Record<string, string> = {};
    for (const c of p.campos) ejemplo[c.key] = `[${c.label}]`;
    const html = this.plantillasSvc.renderizar(p.contenido_html, ejemplo, p.campos);
    this.abierta.set(p);
    this.htmlPreview.set(this.sanitizer.bypassSecurityTrustHtml(html));
  }
  cerrar(): void {
    this.abierta.set(null);
  }

  async marcarDefault(p: PlantillaDocumento): Promise<void> {
    if (this.marcando()) return;
    this.marcando.set(p.id);
    try {
      await this.plantillasSvc.marcarDefault(p.id);
      this.lista.update((l) => l.map((x) => ({ ...x, es_default: x.categoria === p.categoria ? x.id === p.id : x.es_default })));
      this.toast.success(this.i18n.t('Marcada como la que se usa.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo marcar (necesitas el módulo de plantillas).'));
    } finally {
      this.marcando.set(null);
    }
  }

  editar(): void {
    this.toast.show(this.i18n.t('Edita esta plantilla en la web.'), 'info', 4000);
  }

  back(): void {
    this.navGuard.back('/documentos');
  }
}
