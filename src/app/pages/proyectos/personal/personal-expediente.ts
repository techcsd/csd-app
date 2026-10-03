import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { CedulaPipe } from '../../../shared/pipes/cedula-pipe';
import { ActivatedRoute } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PersonalCarnet } from '../../../shared/ui/personal-carnet/personal-carnet';
import { PdfViewer } from '../../../shared/ui/pdf-viewer/pdf-viewer';
import { formatFechaMedia } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CameraService } from '../../../core/services/camera.service';
import { ExportService } from '../../../core/services/export.service';
import { PersonalObraService } from '../../../core/services/personal-obra.service';
import { generarCarnetPdf } from '../../../core/utils/carnet-pdf.util';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import {
  Cargo,
  FotoTipo,
  FOTOS_GUIA,
  NACIONALIDADES,
  NACIONALIDAD_LABEL,
  TIPOS_DOCUMENTO,
  CUADRILLAS,
  ASEGURAMIENTO,
  ASEGURAMIENTO_LABEL,
  Nacionalidad,
  TipoDocumento,
  AseguramientoEstado,
  PersonalObra,
  PersonalFirma,
  FirmaLinea,
  FirmaRol,
  FIRMA_ROL_LABEL,
} from '../../../core/models/personal-obra.model';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';

const SGC_WEB = 'https://sgcconstructorasd.com';

/** AR1 (app) — Expediente del personal: datos, galería (5 fotos + lightbox), carnet
 *  con QR, edición de datos + activar/desactivar (según permisos, offline-safe). */
@Component({
  selector: 'app-personal-expediente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, CollapsibleSelect, OptionButton, ConfirmDialog, PersonalCarnet, PdfViewer, CedulaPipe, TranslatePipe, SignaturePad],
  templateUrl: './personal-expediente.html',
  styleUrl: './personal-expediente.scss',
})
export class PersonalExpedientePage implements OnInit {
  private service = inject(PersonalObraService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private camera = inject(CameraService);
  private exporter = inject(ExportService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly fmtFecha = formatFechaMedia;
  readonly fotosGuia = FOTOS_GUIA;
  readonly nacionalidades = NACIONALIDADES;
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;
  readonly cuadrillas = CUADRILLAS; // AV4
  readonly aseguramientos = ASEGURAMIENTO; // AV4
  readonly aseguramientoLabel = ASEGURAMIENTO_LABEL; // AV4

  personal = signal<PersonalObra | null>(null);
  fotos = signal<Partial<Record<FotoTipo, string>>>({});
  firmas = signal<PersonalFirma[]>([]);
  cargos = signal<Cargo[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  lightboxUrl = signal<string | null>(null);
  confirmEstado = signal(false);
  /** CE4 — tipo de foto que se está subiendo ahora (para el spinner del slot). */
  subiendoFoto = signal<FotoTipo | null>(null);
  // BF8 — visor del documento/contrato firmado (snapshot AZ1).
  docVisor = signal<{ url: string; nombre: string } | null>(null);
  abriendoDoc = signal<string | null>(null);

  // CF1 — líneas de firma por rol (empleador/testigos) + panel de firma.
  readonly rolLabel = FIRMA_ROL_LABEL;
  readonly ordenRoles: FirmaRol[] = ['empleador', 'trabajador', 'testigo_1', 'testigo_2'];
  lineas = signal<Record<string, FirmaLinea[]>>({});
  esLegal = computed(() => this.ctx.esAdmin() || this.ctx.hasModulo('legal') || this.puedeGestionar());
  firmarCtx = signal<{ firma: PersonalFirma; rol: FirmaRol } | null>(null);
  firmarMetodo = signal<'pad' | 'fisico'>('pad');
  firmanteNombre = signal('');
  firmanteCedula = signal('');
  firmarBusy = signal(false);
  firmarError = signal('');
  private linePad = viewChild<SignaturePad>('linePad');
  subiendoDocFirmado = signal(false);

  // Edición inline
  editando = signal(false);
  eNombre = signal('');
  eApellido = signal('');
  eNacionalidad = signal<Nacionalidad>('dominicano');
  eTipoDoc = signal<TipoDocumento>('cedula');
  eDocNumero = signal('');
  eCargoId = signal('');
  eCuadrilla = signal(''); // AV4
  eAseguramiento = signal<AseguramientoEstado>('desconocido'); // AV4
  eTelefono = signal('');
  eNotas = signal('');

  cargoOptions = computed(() => this.cargos().map((c) => ({ id: c.id, label: `${c.nombre} · ${c.codigo}` })));
  cuadrillaOptions = computed(() => this.cuadrillas.map((c) => ({ id: c.value, label: c.label }))); // AV4
  aseguramientoActual = computed(() => this.personal()?.aseguramiento_estado ?? 'desconocido'); // AV4

  puedeGestionar = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('rrhh') ||
      this.ctx.hasModulo('direccion') ||
      this.ctx.puedeOperarSubmodulo('proyectos.personal') ||
      this.ctx.puedeVerObra(),
  );

  fotoPersonaUrl = computed(() => this.fotos()['persona'] ?? null);
  /** CE4 — cuántas de las 5 fotos faltan (para el aviso de "falta foto"). */
  fotosFaltantes = computed(() => this.fotosGuia.filter((g) => !this.fotos()[g.tipo]).length);
  /** CE5 — QR = MISMA URL pública de verificación que la web (`/verificar/<carnet>`). */
  verifyUrl = computed(() => {
    const p = this.personal();
    return p?.carnet_numero ? `${SGC_WEB}/verificar/${p.carnet_numero}` : '';
  });
  /** CE5 — generando/compartiendo el PDF del carnet. */
  compartiendo = signal(false);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set(this.i18n.t('Personal no encontrado.'));
      this.loading.set(false);
      return;
    }
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [p, cargos] = await Promise.all([this.service.getById(id), this.service.getCargos().catch(() => [] as Cargo[])]);
      this.cargos.set(cargos);
      if (!p) {
        this.error.set(this.i18n.t('Personal no encontrado o sin acceso.'));
        return;
      }
      this.personal.set(p);
      const [fotos, firmas] = await Promise.all([this.service.getFotos(id), this.service.getFirmas(id)]);
      this.firmas.set(firmas);
      await this.cargarLineas(firmas); // CF1
      const urls: Partial<Record<FotoTipo, string>> = {};
      for (const f of fotos) {
        const url = await this.service.fotoUrl(f.foto_path);
        if (url) urls[f.tipo] = url;
      }
      this.fotos.set(urls);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo cargar el expediente.'));
    } finally {
      this.loading.set(false);
    }
  }

  cargoNombre(id: string | null | undefined): string {
    const c = this.cargos().find((x) => x.id === id);
    return c ? `${c.nombre} · ${c.codigo}` : '—';
  }

  // ── CF1 — líneas de firma por rol (empleador/testigos) ──────────────────────
  private async cargarLineas(firmas: PersonalFirma[]): Promise<void> {
    if (!this.online) return; // RPC online; sin red se muestran solo los documentos
    const map: Record<string, FirmaLinea[]> = {};
    for (const f of firmas) map[f.id] = await this.service.lineasFirma(f.id);
    this.lineas.set(map);
  }
  lineasDe(firmaId: string): FirmaLinea[] {
    const ls = this.lineas()[firmaId] ?? [];
    return [...ls].sort((a, b) => this.ordenRoles.indexOf(a.rol) - this.ordenRoles.indexOf(b.rol));
  }
  estadoLineaTxt(l: FirmaLinea): string {
    return l.estado === 'firmado' ? this.i18n.t('Firmada') : l.estado === 'papel' ? this.i18n.t('En papel') : this.i18n.t('Pendiente');
  }
  esTestigo(rol: FirmaRol | undefined): boolean { return rol === 'testigo_1' || rol === 'testigo_2'; }

  abrirFirmarLinea(f: PersonalFirma, rol: FirmaRol): void {
    this.firmarCtx.set({ firma: f, rol });
    this.firmarMetodo.set('pad');
    this.firmanteNombre.set('');
    this.firmanteCedula.set('');
    this.firmarError.set('');
  }
  cerrarFirmarLinea(): void { this.firmarCtx.set(null); }

  async guardarFirmarLinea(): Promise<void> {
    const ctx = this.firmarCtx();
    const p = this.personal();
    if (!ctx || !p || this.firmarBusy()) return;
    if (!this.online) { this.firmarError.set(this.i18n.t('Necesitas conexión para registrar la firma.')); return; }
    const metodo = this.firmarMetodo();
    let blob: Blob | null = null;
    if (metodo === 'pad') {
      const pad = this.linePad();
      blob = pad ? await pad.toBlob() : null;
      if (!blob) { this.firmarError.set(this.i18n.t('Dibuja la firma antes de continuar.')); return; }
    } else {
      const doc = await this.camera.pickDocument();
      if (!doc) return;
      blob = doc.blob;
    }
    this.firmarBusy.set(true);
    this.firmarError.set('');
    try {
      await this.service.firmarLinea(ctx.firma, p, ctx.rol, metodo, {
        firma: blob,
        nombre: this.esTestigo(ctx.rol) ? this.firmanteNombre().trim() || null : null,
        cedula: this.esTestigo(ctx.rol) ? this.firmanteCedula().trim() || null : null,
      });
      await this.cargarLineas(this.firmas());
      this.firmarCtx.set(null);
      this.toast.success(this.i18n.t('Firma registrada.'));
    } catch (e: unknown) {
      this.firmarError.set(e instanceof Error ? e.message : this.i18n.t('No se pudo registrar la firma.'));
    } finally {
      this.firmarBusy.set(false);
    }
  }

  /** CF7 — subir el escaneo/foto de un documento firmado en papel al expediente. */
  async subirDocFirmado(): Promise<void> {
    const p = this.personal();
    if (!p || this.subiendoDocFirmado()) return;
    if (!this.online) { this.toast.error(this.i18n.t('Necesitas conexión para subir el documento.')); return; }
    this.subiendoDocFirmado.set(true);
    try {
      const doc = await this.camera.pickDocument();
      if (!doc) return;
      await this.service.subirDocumentoFirmado(p, doc.nombre || this.i18n.t('Documento firmado'), doc.blob, doc.ext);
      await this.load(p.id);
      this.toast.success(this.i18n.t('Documento subido.'));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo subir el documento.'));
    } finally {
      this.subiendoDocFirmado.set(false);
    }
  }

  abrirFoto(url: string | undefined): void {
    if (url) this.lightboxUrl.set(url);
  }

  /**
   * CE4 — añadir/reemplazar una foto desde el expediente (cámara). La compresión
   * aplica el arreglo CE6 (fondo blanco / HEIC / validación de monocromo). Se
   * encola por outbox y se refleja al momento (preview optimista).
   */
  async agregarFoto(tipo: FotoTipo): Promise<void> {
    const p = this.personal();
    if (!p || this.subiendoFoto()) return;
    this.subiendoFoto.set(tipo);
    try {
      const photo = await this.camera.takePhoto();
      if (!photo) return;
      await this.service.enqueueAgregarFoto(p.id, p.proyecto_id, tipo, photo.blob);
      // Optimista: muestra la foto recién tomada sin esperar al sync.
      this.fotos.update((m) => ({ ...m, [tipo]: photo.previewUrl }));
      this.toast.success(this.online ? this.i18n.t('Foto añadida.') : this.i18n.t('Foto guardada — se subirá al reconectar.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo añadir la foto.'));
    } finally {
      this.subiendoFoto.set(null);
    }
  }
  cerrarFoto(): void {
    this.lightboxUrl.set(null);
  }

  /**
   * CE5 — Compartir / Imprimir el carnet: genera el PDF CR80 (frente/dorso) con el
   * mismo diseño de la web y lo manda por el share-sheet (WhatsApp, imprimir, etc.).
   * Registra la reimpresión (auditoría). Requiere carnet emitido (número).
   */
  async compartirCarnet(): Promise<void> {
    const p = this.personal();
    if (!p || this.compartiendo()) return;
    if (!p.carnet_numero) {
      this.toast.error(this.i18n.t('El carnet aún no se ha emitido. Se emite al sincronizar.'));
      return;
    }
    this.compartiendo.set(true);
    try {
      const blob = await generarCarnetPdf(p, {
        fotoUrl: this.fotoPersonaUrl(),
        verifyUrl: this.verifyUrl(),
      });
      void this.service.registrarReimpresion(p.id); // auditoría (best-effort)
      const nombre = `carnet-${p.carnet_numero}`.replace(/[^a-z0-9-]/gi, '');
      const res = await this.exporter.shareRaw(blob, `${nombre}.pdf`, 'application/pdf', this.i18n.t('Carnet de personal'));
      if (res.fallback) this.toast.success(this.i18n.t('Carnet descargado. Compártelo o imprímelo desde tus descargas.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo generar el carnet.'));
    } finally {
      this.compartiendo.set(false);
    }
  }

  // ── BF8 — ver el documento/contrato firmado (PDF inline o imagen) ────────────
  /** El documento firmado congelado (documento_path, snapshot AZ1); si no lo hay,
   *  cae a la firma sola (firma_path). PDF → visor inline; imagen → lightbox. */
  // CF7 — visor del documento HTML (snapshot del contrato) con el estado de las firmas.
  docHtmlVisor = signal<{ nombre: string; html: string } | null>(null);
  verDocumentoHtml(f: PersonalFirma): void {
    const lineas = this.lineasDe(f.id);
    const filas = (lineas.length ? lineas : [{ rol: 'trabajador', estado: 'firmado', firmante_nombre: null } as FirmaLinea])
      .map((l) => {
        const nom = this.esTestigo(l.rol) && l.firmante_nombre ? ` — ${l.firmante_nombre}` : '';
        return `<tr><td style="padding:4px 10px;font-weight:600;">${this.rolLabel[l.rol]}${nom}</td><td style="padding:4px 10px;color:#555;">${this.estadoLineaTxt(l)}</td></tr>`;
      }).join('');
    const bloque = `<div style="margin-top:24px;border-top:1px solid #333;padding-top:8px;"><strong>Firmas</strong><table style="width:100%;border-collapse:collapse;font-size:13px;">${filas}</table></div>`;
    this.docHtmlVisor.set({ nombre: f.documento_nombre, html: (f.documento_html ?? '') + bloque });
  }
  cerrarDocHtml(): void { this.docHtmlVisor.set(null); }

  async abrirDocumento(f: PersonalFirma): Promise<void> {
    // CF7 — si es un contrato generado (tiene HTML), se muestra el documento + firmas.
    if (f.documento_html) { this.verDocumentoHtml(f); return; }
    if (this.abriendoDoc()) return;
    const path = f.documento_path || f.firma_path;
    if (!path) {
      this.toast.error(this.i18n.t('Este documento no tiene archivo adjunto.'));
      return;
    }
    this.abriendoDoc.set(f.id);
    try {
      const url = await this.service.fotoUrl(path);
      if (!url) {
        this.toast.error(this.i18n.t('No se pudo abrir el documento.'));
        return;
      }
      if (/\.pdf(\?|$)/i.test(path)) {
        this.docVisor.set({ url, nombre: f.documento_nombre || this.i18n.t('Documento firmado') });
      } else {
        this.lightboxUrl.set(url);
      }
    } catch {
      this.toast.error(this.i18n.t('No se pudo abrir el documento.'));
    } finally {
      this.abriendoDoc.set(null);
    }
  }
  cerrarDoc(): void {
    this.docVisor.set(null);
  }

  // ── Edición ────────────────────────────────────────────────────────────────
  editar(): void {
    const p = this.personal();
    if (!p) return;
    this.eNombre.set(p.nombre);
    this.eApellido.set(p.apellido ?? '');
    this.eNacionalidad.set(p.nacionalidad);
    this.eTipoDoc.set(p.tipo_documento);
    this.eDocNumero.set(p.documento_numero ?? '');
    this.eCargoId.set(p.cargo_id ?? '');
    this.eCuadrilla.set((p.cuadrilla as string) ?? ''); // AV4
    this.eAseguramiento.set(p.aseguramiento_estado ?? 'desconocido'); // AV4
    this.eTelefono.set(p.telefono ?? '');
    this.eNotas.set(p.notas ?? '');
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
  }

  async guardarEdicion(): Promise<void> {
    const p = this.personal();
    if (!p || this.saving()) return;
    if (!this.eNombre().trim()) {
      this.toast.error(this.i18n.t('El nombre es obligatorio.'));
      return;
    }
    this.saving.set(true);
    try {
      const cambios: Partial<PersonalObra> = {
        nombre: this.eNombre().trim(),
        apellido: this.eApellido().trim() || null,
        nacionalidad: this.eNacionalidad(),
        tipo_documento: this.eTipoDoc(),
        documento_numero: this.eDocNumero().trim() || null,
        cargo_id: this.eCargoId() || null,
        cuadrilla: this.eCuadrilla() || null, // AV4
        aseguramiento_estado: this.eAseguramiento(), // AV4
        telefono: this.eTelefono().trim() || null,
        notas: this.eNotas().trim() || null,
      };
      await this.service.enqueueEditar(p.id, cambios);
      // Optimista: refleja los cambios (el cargo join se resuelve del catálogo).
      const cargo = this.cargos().find((c) => c.id === (cambios.cargo_id ?? null)) ?? null;
      this.personal.set({ ...p, ...cambios, cargo });
      this.editando.set(false);
      this.toast.success(this.i18n.t('Cambios guardados. Se sincronizarán en segundo plano.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudieron guardar los cambios.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Activar / desactivar ─────────────────────────────────────────────────────
  pedirCambioEstado(): void {
    this.confirmEstado.set(true);
  }
  cancelarEstado(): void {
    this.confirmEstado.set(false);
  }
  async confirmarEstado(): Promise<void> {
    const p = this.personal();
    if (!p) return;
    this.confirmEstado.set(false);
    const nuevo = p.estado === 'activo' ? 'inactivo' : 'activo';
    this.saving.set(true);
    try {
      await this.service.enqueueEstado(p.id, nuevo);
      this.personal.set({ ...p, estado: nuevo });
      this.toast.success(nuevo === 'inactivo' ? this.i18n.t('Personal desactivado.') : this.i18n.t('Personal reactivado.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cambiar el estado.'));
    } finally {
      this.saving.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  back(): void {
    this.location.back();
  }
}
