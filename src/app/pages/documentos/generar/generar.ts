import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PlantillasDocumentoService } from '../../../core/services/plantillas-documento.service';
import { DocumentosGeneradosService } from '../../../core/services/documentos-generados.service';
import { ExportService } from '../../../core/services/export.service';
import { SolicitudesCompraService } from '../../../core/services/solicitudes-compra.service';
import { PlantillaDocumento } from '../../../core/models/plantilla-documento.model';
import { Proyecto } from '../../../core/models/bitacora.model';
import { construirValoresAuto } from '../../../core/utils/plantilla-merge.util';
import { generarDocumentoPdf } from '../../../core/utils/documento-pdf.util';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

type Paso = 'plantilla' | 'datos' | 'preview' | 'exito';

/**
 * CO12/CO13 — "Generar" documento: elegir plantilla → llenar los datos → vista
 * previa (HTML fusionado) → guardar + PDF + compartir por WhatsApp. Si la
 * plantilla es de tipo Contrato, ofrece "Crear contrato en Legal con este
 * documento" al terminar (CO13.3). Mismo motor de merge que `personal-registro.ts`
 * (`PlantillasDocumentoService.renderizar` + `construirValoresAuto`).
 */
@Component({
  selector: 'app-documentos-generar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './generar.html',
  styleUrl: './generar.scss',
})
export class DocumentosGenerarPage {
  private plantillasSvc = inject(PlantillasDocumentoService);
  private documentosSvc = inject(DocumentosGeneradosService);
  private solicitudesCompra = inject(SolicitudesCompraService);
  private exportSvc = inject(ExportService);
  private sanitizer = inject(DomSanitizer);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  loading = signal(true);
  plantillas = signal<PlantillaDocumento[]>([]);
  paso = signal<Paso>('plantilla');

  plantillaSel = signal<PlantillaDocumento | null>(null);
  valores = signal<Record<string, string>>({});
  nombreDocumento = signal('');
  proyectos = signal<Proyecto[]>([]);
  proyectoOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));
  proyectoId = signal('');

  guardando = signal(false);
  compartiendo = signal(false);
  documentoCreadoId = signal<string | null>(null);

  htmlPreview = computed<SafeHtml>(() => {
    const pl = this.plantillaSel();
    if (!pl) return '';
    const html = this.plantillasSvc.renderizar(pl.contenido_html, this.valores(), pl.campos ?? []);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  esContrato = computed(() => this.plantillaSel()?.categoria === 'contrato');

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const todas = await this.plantillasSvc.getAll();
      const categoria = this.route.snapshot.queryParamMap.get('categoria');
      this.plantillas.set(categoria ? todas.filter((p) => p.categoria === categoria) : todas);
    } catch {
      this.plantillas.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async elegirPlantilla(p: PlantillaDocumento): Promise<void> {
    this.plantillaSel.set(p);
    this.nombreDocumento.set(p.nombre);
    const empresa = await this.plantillasSvc.getEmpresa().catch(() => null);
    this.valores.set(
      construirValoresAuto({ empresa, hoyIso: new Date().toISOString().slice(0, 10) }),
    );
    if (!this.proyectos().length) {
      this.solicitudesCompra.getProyectos().then((p2) => this.proyectos.set(p2)).catch(() => {});
    }
    this.paso.set('datos');
  }

  setValor(key: string, value: string): void {
    this.valores.update((v) => ({ ...v, [key]: value }));
  }

  irAPreview(): void {
    const pl = this.plantillaSel();
    if (!pl) return;
    const faltan = (pl.campos ?? []).filter((c) => !this.valores()[c.key]?.trim());
    if (faltan.length) {
      this.toast.error(this.i18n.t('Completa: ') + faltan.map((f) => f.label).join(', '));
      return;
    }
    this.paso.set('preview');
  }

  volverADatos(): void {
    this.paso.set('datos');
  }

  async guardar(): Promise<void> {
    const pl = this.plantillaSel();
    if (!pl || this.guardando()) return;
    this.guardando.set(true);
    try {
      const contenidoFinal = this.plantillasSvc.renderizar(pl.contenido_html, this.valores(), pl.campos ?? []);
      const id = await this.documentosSvc.crear({
        plantillaId: pl.id,
        proyectoId: this.proyectoId() || null,
        nombre: this.nombreDocumento().trim() || pl.nombre,
        valores: this.valores(),
        contenidoHtmlFinal: contenidoFinal,
      });
      this.documentoCreadoId.set(id);
      this.paso.set('exito');
      this.toast.success(this.i18n.t('Documento generado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo generar el documento.'));
    } finally {
      this.guardando.set(false);
    }
  }

  async compartir(): Promise<void> {
    const pl = this.plantillaSel();
    if (!pl || this.compartiendo()) return;
    this.compartiendo.set(true);
    try {
      const contenidoFinal = this.plantillasSvc.renderizar(pl.contenido_html, this.valores(), pl.campos ?? []);
      const nombre = this.nombreDocumento().trim() || pl.nombre;
      const blob = generarDocumentoPdf(contenidoFinal, { titulo: nombre });
      const base = nombre.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'documento';
      const res = await this.exportSvc.shareRaw(blob, `${base}.pdf`, 'application/pdf', nombre);
      if (res.fallback) this.toast.success(this.i18n.t('Documento descargado. Compártelo desde tus descargas.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo generar el PDF.'));
    } finally {
      this.compartiendo.set(false);
    }
  }

  crearContratoConEsteDocumento(): void {
    const id = this.documentoCreadoId();
    if (!id) return;
    void this.router.navigate(['/legal/contratos'], {
      queryParams: { docId: id, nombre: this.nombreDocumento().trim() || this.plantillaSel()?.nombre },
    });
  }

  nuevoDocumento(): void {
    this.plantillaSel.set(null);
    this.valores.set({});
    this.documentoCreadoId.set(null);
    this.paso.set('plantilla');
  }

  back(): void {
    if (this.paso() === 'plantilla') this.navGuard.back('/documentos');
    else if (this.paso() === 'datos') this.paso.set('plantilla');
    else if (this.paso() === 'preview') this.paso.set('datos');
    else this.navGuard.back('/documentos');
  }
}
