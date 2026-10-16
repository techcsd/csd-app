import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { LegalService } from '../../../core/services/legal.service';
import { DocumentosGeneradosService } from '../../../core/services/documentos-generados.service';
import { SolicitudesCompraService } from '../../../core/services/solicitudes-compra.service';
import { Contrato, ContratoDetalle, ContratoEstado, ContratoTipo } from '../../../core/models/legal.model';
import { DocumentoGenerado } from '../../../core/models/documento-generado.model';
import { Proyecto } from '../../../core/models/bitacora.model';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { PdfViewer } from '../../../shared/ui/pdf-viewer/pdf-viewer';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatFechaMedia } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const TIPO_LABEL: Record<ContratoTipo, string> = {
  subcontrato: 'Subcontrato',
  proveedor: 'Proveedor',
  laboral: 'Laboral',
  arrendamiento: 'Arrendamiento',
  servicios: 'Servicios',
  otro: 'Otro',
};
const ESTADO_LABEL: Record<ContratoEstado, string> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  firmado: 'Firmado',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
};

type Camino = 'plantilla' | 'usar' | 'subir' | null;

/**
 * CO13 — Contratos: lista + ficha (con el documento ligado) + creación por los 3
 * caminos (generar ahora / usar uno ya generado / subir el PDF firmado). Solo en
 * línea (sin RPC de listado/creación del padre — acceso directo + RLS).
 */
@Component({
  selector: 'app-contratos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, CollapsibleSelect, PdfViewer, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './contratos.html',
  styleUrl: './contratos.scss',
})
export class ContratosPage {
  private legal = inject(LegalService);
  private documentos = inject(DocumentosGeneradosService);
  private solicitudesCompra = inject(SolicitudesCompraService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  tipoLabel = (t: ContratoTipo): string => TIPO_LABEL[t] ?? t;
  estadoLabel = (e: ContratoEstado): string => ESTADO_LABEL[e] ?? e;
  fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  lista = signal<Contrato[]>([]);

  abierto = signal<ContratoDetalle | null>(null);
  cargandoDetalle = signal(false);
  verPdfFirmado = signal(false);
  subiendoFirmado = signal(false);

  // ── Crear ───────────────────────────────────────────────────────────────
  creando = signal(false);
  camino = signal<Camino>(null);
  guardandoNuevo = signal(false);
  proyectos = signal<Proyecto[]>([]);
  proyectoOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));
  documentosContrato = signal<DocumentoGenerado[]>([]);
  documentoOptions = computed(() => this.documentosContrato().map((d) => ({ id: d.id, label: d.nombre })));
  documentoElegidoId = signal('');
  archivoFirmadoBlob = signal<File | null>(null);

  nTitulo = signal('');
  nTipo = signal<ContratoTipo>('subcontrato');
  nContraparte = signal('');
  nProyectoId = signal('');
  nMonto = signal<number | null>(null);
  nVencimiento = signal('');
  readonly tipos: ContratoTipo[] = ['subcontrato', 'proveedor', 'laboral', 'arrendamiento', 'servicios', 'otro'];

  constructor() {
    void this.cargar();
    // CO13 — volviendo de "Generar documento" con "Crear contrato en Legal con este documento".
    const docId = this.route.snapshot.queryParamMap.get('docId');
    const nombre = this.route.snapshot.queryParamMap.get('nombre');
    if (docId) {
      void this.abrirCrear();
      this.camino.set('usar');
      this.documentoElegidoId.set(docId);
      if (nombre) this.nTitulo.set(nombre);
    }
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.lista.set(await this.legal.listarContratos());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async abrir(c: Contrato): Promise<void> {
    this.cargandoDetalle.set(true);
    try {
      const det = await this.legal.contratoDetalle(c.id);
      if (!det) {
        this.toast.error(this.i18n.t('No pudimos abrir este contrato.'));
        return;
      }
      this.abierto.set(det);
    } finally {
      this.cargandoDetalle.set(false);
    }
  }
  cerrarFicha(): void {
    this.abierto.set(null);
    this.verPdfFirmado.set(false);
    this.urlFirmado.set(null);
  }

  urlFirmado = signal<string | null>(null);
  async verFirmado(): Promise<void> {
    const d = this.abierto();
    const path = d?.contrato.archivo_firmado_path;
    if (!path) return;
    this.urlFirmado.set(await this.legal.firmarUrlContrato(path));
    this.verPdfFirmado.set(true);
  }

  async verDocumentoGenerado(): Promise<void> {
    // CO13 — el documento ligado se ve como HTML (mismo criterio que personal-expediente:
    // el snapshot del documento no necesita un PDF para verse, solo para compartir).
    this.toast.show(this.i18n.t('Abre "Historial" en Documentos para ver este documento.'), 'info');
    void this.router.navigate(['/documentos/historial']);
  }

  async onFirmadoElegido(ev: Event): Promise<void> {
    const d = this.abierto();
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!d || !file || this.subiendoFirmado()) return;
    this.subiendoFirmado.set(true);
    try {
      await this.legal.subirFirmado(d.contrato.id, file, file.type || 'application/pdf');
      await this.abrir({ id: d.contrato.id } as Contrato);
      this.toast.success(this.i18n.t('Contrato firmado subido.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo subir el archivo.'));
    } finally {
      this.subiendoFirmado.set(false);
    }
  }

  // ── Crear ───────────────────────────────────────────────────────────────
  async abrirCrear(): Promise<void> {
    this.creando.set(true);
    this.camino.set(null);
    this.nTitulo.set('');
    this.nTipo.set('subcontrato');
    this.nContraparte.set('');
    this.nProyectoId.set('');
    this.nMonto.set(null);
    this.nVencimiento.set('');
    this.documentoElegidoId.set('');
    this.archivoFirmadoBlob.set(null);
    if (!this.proyectos().length) {
      this.solicitudesCompra.getProyectos().then((p) => this.proyectos.set(p)).catch(() => {});
    }
  }
  cerrarCrear(): void {
    this.creando.set(false);
    // Limpia el query param de retorno (CO13) para no reabrir la hoja al refrescar.
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  async elegirCamino(c: Camino): Promise<void> {
    this.camino.set(c);
    if (c === 'usar' && !this.documentosContrato().length) {
      try {
        const h = await this.documentos.historial();
        this.documentosContrato.set(h.filter((d) => d.plantilla_categoria === 'contrato'));
      } catch {
        /* best-effort */
      }
    }
  }

  generarAhora(): void {
    void this.router.navigate(['/documentos/generar'], { queryParams: { categoria: 'contrato' } });
  }

  onArchivoFirmadoElegido(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.archivoFirmadoBlob.set(input.files?.[0] ?? null);
  }

  async guardarNuevo(): Promise<void> {
    const titulo = this.nTitulo().trim();
    const contraparte = this.nContraparte().trim();
    if (!titulo || !contraparte) {
      this.toast.error(this.i18n.t('Escribe el título y la contraparte.'));
      return;
    }
    if (this.camino() === 'subir' && !this.archivoFirmadoBlob()) {
      this.toast.error(this.i18n.t('Elige el PDF firmado.'));
      return;
    }
    if (this.guardandoNuevo()) return;
    this.guardandoNuevo.set(true);
    try {
      const id = await this.legal.crearContrato({
        titulo,
        tipo: this.nTipo(),
        contraparteNombre: contraparte,
        proyectoId: this.nProyectoId() || null,
        monto: this.nMonto(),
        fechaVencimiento: this.nVencimiento() || null,
        documentoGeneradoId: this.camino() === 'usar' ? this.documentoElegidoId() || null : null,
      });
      const blob = this.archivoFirmadoBlob();
      if (this.camino() === 'subir' && blob) {
        await this.legal.subirFirmado(id, blob, blob.type || 'application/pdf');
      }
      this.toast.success(this.i18n.t('Contrato creado.'));
      this.creando.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo crear el contrato.'));
    } finally {
      this.guardandoNuevo.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/legal');
  }
}
