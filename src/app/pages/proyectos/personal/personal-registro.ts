import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CedulaMask } from '../../../shared/ui/cedula-mask.directive';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PersonalCarnet } from '../../../shared/ui/personal-carnet/personal-carnet';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { MotionService } from '../../../core/services/motion.service';
import { NetworkService } from '../../../core/services/network.service';
import { IaConsentGate } from '../../../core/services/ia-consent-gate.service';
import { PersonalObraService, LecturaDocumentoPersonal } from '../../../core/services/personal-obra.service';
import { PlantillasDocumentoService } from '../../../core/services/plantillas-documento.service';
import { PlantillaDocumento, EmpresaLite } from '../../../core/models/plantilla-documento.model';
import { construirValoresAuto } from '../../../core/utils/plantilla-merge.util';
import {
  Cargo,
  FotoTipo,
  FOTOS_GUIA,
  NACIONALIDADES,
  TIPOS_DOCUMENTO,
  CUADRILLAS,
  ASEGURAMIENTO,
  Nacionalidad,
  TipoDocumento,
  AseguramientoEstado,
  PersonalObra,
} from '../../../core/models/personal-obra.model';

/** URL base de la web SGC (verificación del carnet por QR → expediente web). */
const SGC_WEB = 'https://sgcconstructorasd.com';

/** AR1/CF1 — firma del documento ACTIVADA (Xaviel: "dale"). El wizard inserta el paso de
 *  firma del trabajador; el servicio la sube por outbox y siembra las líneas del empleador
 *  y testigos, que Legal completa desde el expediente (ahora / en papel / después). */
const FIRMA_HABILITADA = true;

/** AR1 — hojas del wizard de registro de personal (una pregunta por pantalla).
 *  DB2 — `modo` (elegir rápido/completo) y `fotos_rapidas` (las 2 fotos del
 *  Registro rápido) son exclusivas del modo rápido; `documento`/`fotos` (las 5
 *  fotos guiadas) son exclusivas del modo completo. */
type PasoKey = 'modo' | 'datos' | 'documento' | 'fotos' | 'fotos_rapidas' | 'firma' | 'carnet' | 'resumen';

/** DB2 — "Registro rápido (2 fotos)": toma documento + persona-con-documento y deja
 *  que la IA pre-llene nombre/apellido/nacionalidad/tipo/n° de documento (editable). */
type ModoRegistro = 'rapido' | 'completo';

/** AE9 — slice persistido del registro (sin fotos/firma, que van a borrador_fotos). */
interface RegistroDraft {
  id: string;
  proyectoId: string;
  nombre: string;
  apellido: string;
  nacionalidad: Nacionalidad;
  tipoDocumento: TipoDocumento;
  documentoNumero: string;
  cargoId: string;
  cuadrilla: string; // AV4
  aseguramiento: AseguramientoEstado; // AV4
  telefono: string;
  notas: string;
}

/**
 * AR1 (app) — Registro de Personal EN OBRA por hojas (offline-first):
 * Datos → Documento → Fotos guiadas → (⏸ Firma) → Carnet → Resumen → Registrar.
 * Cada foto es solo-cámara (bypass admin), con su guía visual. Borrador AE9 durante
 * todo el wizard (texto + fotos) → si crashea o se interrumpe, se retoma. El envío
 * va por outbox: el carnet (CSD-######) se emite en el servidor al sincronizar.
 */
@Component({
  selector: 'app-personal-registro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    CedulaMask,
    CollapsibleSelect,
    OptionButton,
    WizardFooter,
    StepBar,
    PhotoSlot,
    SignaturePad,
    DraftBanner,
    BigConfirm,
    ConfirmDialog,
    PersonalCarnet,
    TranslatePipe,
    ...MOTION_DIRECTIVES,
  ],
  templateUrl: './personal-registro.html',
  styleUrl: './personal-registro.scss',
})
export class PersonalRegistroPage implements OnDestroy {
  private service = inject(PersonalObraService);
  private plantillas = inject(PlantillasDocumentoService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private motion = inject(MotionService);
  private network = inject(NetworkService);
  private iaGate = inject(IaConsentGate);

  readonly nacionalidades = NACIONALIDADES;
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly cuadrillas = CUADRILLAS; // AV4
  readonly aseguramientos = ASEGURAMIENTO; // AV4
  readonly firmaHabilitada = FIRMA_HABILITADA;
  /** Guía de la foto del documento (paso 2, y 1ra foto del modo rápido). */
  readonly guiaDocumento = FOTOS_GUIA.find((g) => g.tipo === 'documento')!;
  /** DB2 — 2da foto del modo rápido (persona sosteniendo el documento). */
  readonly guiaPersonaDoc = FOTOS_GUIA.find((g) => g.tipo === 'persona_carnet_cedula')!;
  /** CP1/AW12 — glifos desde TS (guarda no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyphRapido = '⚡';
  readonly glyphCompleto = '📝';
  /** Fotos guiadas del paso 3 (todas menos el documento, que va en el paso 2). */
  readonly guiaFotos = FOTOS_GUIA.filter((g) => g.tipo !== 'documento');

  // ── DB2 — Registro rápido (2 fotos) ───────────────────────────────────────
  modoRegistro = signal<ModoRegistro>('completo');
  leyendoDocumento = signal(false);
  lecturaDocError = signal('');
  /** Etiquetas de los campos que la IA llenó (para el aviso "Leído: …"). */
  lecturaDocOk = signal<string[]>([]);
  /** `coincide_rostro` 'no'|'dudoso' → aviso visible, no bloquea. */
  rostroDudoso = signal(false);
  marcandoPresente = signal(false);

  private readonly clave = 'proyectos:personal-registro';
  private hydrated = false;
  draftFecha = signal<number | null>(null);

  private pad = viewChild<SignaturePad>('firmaPad');

  hoja = signal<'form' | 'exito'>('form');
  loading = signal(true);
  submitting = signal(false);
  confirmSalir = signal(false);

  // Catálogos
  obras = signal<{ id: string; nombre: string }[]>([]);
  cargos = signal<Cargo[]>([]);

  // Datos
  registroId = signal('');
  proyectoId = signal('');
  nombre = signal('');
  apellido = signal('');
  nacionalidad = signal<Nacionalidad>('dominicano');
  tipoDocumento = signal<TipoDocumento>('cedula');
  documentoNumero = signal('');
  cargoId = signal('');
  cuadrilla = signal(''); // AV4 — eje TECNICO (cuadrilla)
  aseguramiento = signal<AseguramientoEstado>('desconocido'); // AV4
  telefono = signal('');
  notas = signal('');

  // Fotos (mapa tipo → foto capturada). El padre es dueño de las object-URL.
  fotos = signal<Partial<Record<FotoTipo, CapturedPhoto>>>({});
  // Firma
  firma = signal<Blob | null>(null);
  documentoFirmaNombre = signal(this.i18n.t('Acuerdo de registro de personal de obra'));
  // CF7 — plantilla por defecto (contrato) + empresa, para generar el documento real.
  plantillaContrato = signal<PlantillaDocumento | null>(null);
  empresa = signal<EmpresaLite | null>(null);
  /** Valores resueltos (empresa/trabajador/obra + letras) para el merge. */
  valoresContrato = computed<Record<string, string>>(() =>
    construirValoresAuto({
      empresa: this.empresa(),
      persona: {
        nombre: this.nombre(), apellido: this.apellido(), documento_numero: this.documentoNumero(),
        cargo: this.cargoSel()?.nombre ?? null, telefono: this.telefono(),
        nacionalidad: this.nacionalidadLabel(),
      },
      obra: { nombre: this.obraNombre() },
      hoyIso: new Date().toISOString().slice(0, 10),
    }),
  );
  /** HTML del contrato ya resuelto (snapshot que se firma), o '' si no hay plantilla. */
  contratoHtml = computed(() => {
    const pl = this.plantillaContrato();
    if (!pl) return '';
    return this.plantillas.renderizar(pl.contenido_html, this.valoresContrato(), pl.campos ?? []);
  });

  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  cargoOptions = computed(() => this.cargos().map((c) => ({ id: c.id, label: `${c.nombre} · ${c.codigo}` })));
  cuadrillaOptions = computed(() => this.cuadrillas.map((c) => ({ id: c.value, label: this.i18n.t(c.label) }))); // AV4
  cuadrillaLabel = computed(() => this.cuadrillas.find((c) => c.value === this.cuadrilla())?.label ?? '');

  cargoSel = computed<Cargo | null>(() => this.cargos().find((c) => c.id === this.cargoId()) ?? null);
  obraNombre = computed(() => this.obras().find((o) => o.id === this.proyectoId())?.nombre ?? '');
  nacionalidadLabel = computed(() => this.nacionalidades.find((n) => n.value === this.nacionalidad())?.label ?? '');
  tipoDocLabel = computed(() => this.tiposDocumento.find((t) => t.value === this.tipoDocumento())?.label ?? '');
  requiereDocumento = computed(() => this.tipoDocumento() !== 'ninguno');

  fotosTomadas = computed(() => Object.values(this.fotos()).filter(Boolean).length);
  /** URL de verificación del carnet (QR → expediente en la web SGC). */
  verifyUrl = computed(() => `${SGC_WEB}/proyectos/personal/${this.registroId()}`);

  /** Objeto tipo PersonalObra para renderizar la vista previa del carnet. */
  carnetPreview = computed<PersonalObra>(() => {
    const now = new Date().toISOString();
    return {
      id: this.registroId(),
      proyecto_id: this.proyectoId(),
      nombre: this.nombre().trim(),
      apellido: this.apellido().trim() || null,
      nacionalidad: this.nacionalidad(),
      tipo_documento: this.tipoDocumento(),
      documento_numero: this.documentoNumero().trim() || null,
      cargo_id: this.cargoId() || null,
      estado: 'activo',
      carnet_numero: null,
      created_at: now,
      updated_at: now,
      cargo: this.cargoSel(),
      proyecto: { nombre: this.obraNombre() },
    };
  });
  fotoPersonaUrl = computed(() => this.fotos()['persona']?.previewUrl ?? null);

  // ── Wizard ─────────────────────────────────────────────────────────────────
  paso = signal(0);

  pasos = computed<{ key: PasoKey; titulo: string }[]>(() => {
    const p: { key: PasoKey; titulo: string }[] = [{ key: 'modo', titulo: this.i18n.t('Tipo de registro') }];
    if (this.modoRegistro() === 'rapido') {
      // DB2 — rápido: 2 fotos primero (con lectura IA de fondo) → datos pre-llenos.
      // Las otras 3 fotos guiadas y el paso "documento" se saltan (CE4: opcionales).
      p.push({ key: 'fotos_rapidas', titulo: this.i18n.t('Fotos del documento') });
      p.push({ key: 'datos', titulo: this.i18n.t('Datos de la persona') });
    } else {
      p.push({ key: 'datos', titulo: this.i18n.t('Datos de la persona') });
      p.push({ key: 'documento', titulo: this.i18n.t('Documento de identidad') });
      p.push({ key: 'fotos', titulo: this.i18n.t('Fotos de evidencia') });
    }
    if (FIRMA_HABILITADA) p.push({ key: 'firma', titulo: this.i18n.t('Firma del documento') });
    p.push({ key: 'carnet', titulo: this.i18n.t('Carnet') });
    p.push({ key: 'resumen', titulo: this.i18n.t('Revisar y registrar') });
    return p;
  });

  pasoActual = computed(() => this.pasos()[Math.min(this.paso(), this.pasos().length - 1)]);
  esUltimo = computed(() => this.paso() >= this.pasos().length - 1);

  pasoValido = computed(() => {
    switch (this.pasoActual()?.key) {
      case 'modo':
        return true;
      case 'datos':
        return !!(this.proyectoId() && this.nombre().trim() && this.nacionalidad() && this.cargoId());
      // CE4 — las 5 fotos son OPCIONALES: ni el documento ni la foto de la persona
      // son un muro. Se marcan como "Falta foto" en el expediente y se añaden luego.
      case 'documento':
        return true;
      case 'fotos':
        return true;
      // DB2 — las 2 fotos del modo rápido tampoco son un muro (CE4): se puede seguir
      // sin ellas y llenar los datos a mano en el siguiente paso.
      case 'fotos_rapidas':
        return true;
      case 'firma':
        return !!this.firma();
      case 'carnet':
        return true;
      case 'resumen':
        return this.puedeRegistrar();
      default:
        return false;
    }
  });

  // CE4 — registrar sin foto: solo los DATOS son obligatorios (obra, nombre,
  // nacionalidad, cargo). Las fotos ya no bloquean el registro.
  puedeRegistrar = computed(
    () =>
      !!(this.proyectoId() && this.nombre().trim() && this.nacionalidad() && this.cargoId()),
  );

  /** CE4 — tipos de foto que faltan (para el aviso suave en el resumen). */
  fotosFaltantes = computed(() => FOTOS_GUIA.filter((g) => !this.fotos()[g.tipo]).length);

  // ── CE16 — aviso de documento duplicado (suave, no bloquea) ──────────────────
  dupAviso = signal<{ id: string; nombre: string; proyecto: string | null }[]>([]);
  private dupCheckToken = 0;

  primaryBtn = computed(() => {
    if (this.submitting()) return this.i18n.t('Registrando…');
    return this.esUltimo() ? this.i18n.t('Registrar') : this.i18n.t('Siguiente');
  });

  private readonly backHandler = (): boolean => {
    if (this.hoja() !== 'form') return false;
    if (this.confirmSalir()) {
      this.confirmSalir.set(false);
      return true;
    }
    if (this.paso() > 0) {
      this.paso.update((p) => p - 1);
      return true;
    }
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.init();
    this.navGuard.register(this.backHandler);
    effect(() => this.autosaveEffect());
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    this.revocarFotos();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    this.registroId.set(crypto.randomUUID());
    try {
      const [obras, cargos] = await Promise.all([
        this.service.getObras().catch(() => [] as { id: string; nombre: string }[]),
        this.service.getCargos().catch(() => [] as Cargo[]),
      ]);
      this.obras.set(obras);
      this.cargos.set(cargos);
      // CF7 — plantilla por defecto de contrato + empresa (para generar el documento real).
      // Best-effort/cacheado: si no hay red ni caché, se firma con el nombre libre de siempre.
      void Promise.all([
        this.plantillas.plantillaDefault('contrato').catch(() => null),
        this.plantillas.getEmpresa().catch(() => null),
      ]).then(([pl, emp]) => {
        this.empresa.set(emp);
        if (pl) { this.plantillaContrato.set(pl); this.documentoFirmaNombre.set(pl.nombre); }
      });
      // Preselección de obra: query ?obra= o la obra activa del usuario (capataz/ingeniero).
      const preObra = this.route.snapshot.queryParamMap.get('obra') ?? this.ctx.obraActiva()?.id ?? '';
      if (preObra && obras.some((o) => o.id === preObra)) this.proyectoId.set(preObra);
      // AE9 — ofrecer retomar un borrador previo.
      const d = await this.borrador.get(this.clave);
      if (d) this.draftFecha.set(d.updated_at);
      else this.hydrated = true;
    } finally {
      this.loading.set(false);
    }
  }

  /** AE9 — snapshot + autosave (texto). Las fotos se persisten al capturarlas. */
  private autosaveEffect(): void {
    const snap: RegistroDraft = {
      id: this.registroId(),
      proyectoId: this.proyectoId(),
      nombre: this.nombre(),
      apellido: this.apellido(),
      nacionalidad: this.nacionalidad(),
      tipoDocumento: this.tipoDocumento(),
      documentoNumero: this.documentoNumero(),
      cargoId: this.cargoId(),
      cuadrilla: this.cuadrilla(),
      aseguramiento: this.aseguramiento(),
      telefono: this.telefono(),
      notas: this.notas(),
    };
    if (!this.hydrated || this.hoja() === 'exito' || this.submitting()) return;
    if (!this.tieneDatos()) return;
    this.autosave.queue(this.clave, snap, {
      tipo: 'personal',
      etiqueta: this.i18n.t('Registro de personal'),
      ruta: this.location.path(),
    });
  }

  continuarBorrador(): void {
    void (async () => {
      const d = await this.borrador.load<RegistroDraft>(this.clave);
      if (d) {
        if (d.id) this.registroId.set(d.id);
        this.proyectoId.set(d.proyectoId ?? '');
        this.nombre.set(d.nombre ?? '');
        this.apellido.set(d.apellido ?? '');
        this.nacionalidad.set(d.nacionalidad ?? 'dominicano');
        this.tipoDocumento.set(d.tipoDocumento ?? 'cedula');
        this.documentoNumero.set(d.documentoNumero ?? '');
        this.cargoId.set(d.cargoId ?? '');
        this.cuadrilla.set(d.cuadrilla ?? '');
        this.aseguramiento.set(d.aseguramiento ?? 'desconocido');
        this.telefono.set(d.telefono ?? '');
        this.notas.set(d.notas ?? '');
      }
      // Rehidrata las fotos persistidas (survive OS kill).
      const fotos = await this.borrador.loadFotos(this.clave);
      const map: Partial<Record<FotoTipo, CapturedPhoto>> = {};
      for (const f of fotos) {
        if (f.slot === 'firma') this.firma.set(f.blob);
        else map[f.slot as FotoTipo] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
      }
      this.fotos.set(map);
      this.draftFecha.set(null);
      this.hydrated = true;
    })();
  }

  descartarBorrador(): void {
    void this.autosave.discard(this.clave);
    this.draftFecha.set(null);
    this.hydrated = true;
  }

  // ── Fotos ────────────────────────────────────────────────────────────────
  fotoDe(tipo: FotoTipo): CapturedPhoto | null {
    return this.fotos()[tipo] ?? null;
  }

  onFoto(tipo: FotoTipo, photo: CapturedPhoto): void {
    const prev = this.fotos()[tipo];
    if (prev?.previewUrl && prev.previewUrl !== photo.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    this.fotos.update((m) => ({ ...m, [tipo]: photo }));
    void this.borrador.saveFoto(this.clave, tipo, photo.blob); // AE9 — persiste la foto
  }

  onFotoClear(tipo: FotoTipo): void {
    const prev = this.fotos()[tipo];
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    this.fotos.update((m) => {
      const next = { ...m };
      delete next[tipo];
      return next;
    });
    void this.borrador.removeFoto(this.clave, tipo);
  }

  private revocarFotos(): void {
    for (const f of Object.values(this.fotos())) {
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
  }

  // ── DB2 — Registro rápido (2 fotos + lectura IA) ────────────────────────────
  /** Foto del paso rápido: guarda + dispara la lectura IA en cuanto estén las 2. */
  onFotoRapida(tipo: FotoTipo, photo: CapturedPhoto): void {
    this.onFoto(tipo, photo);
    this.lecturaDocError.set('');
    if (this.fotoDe('documento') && this.fotoDe('persona_carnet_cedula')) void this.leerDocumentoAuto();
  }

  /** Reduce una imagen a ~1600px y devuelve base64 sin prefijo (mismo patrón que
   *  combustible.ts/imagenBase64, para la edge `leer-documento-personal`). */
  private async imagenBase64(blob: Blob, max = 1600): Promise<{ data: string; mime: string }> {
    const bitmap = await createImageBitmap(blob);
    const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.split(',')[1] ?? '', mime: 'image/jpeg' };
  }

  /**
   * DB2 — lee documento+persona con IA para pre-llenar los datos (todo editable
   * luego). Consentimiento de IA ANTES de llamar a la edge (evita un viaje gastado
   * si el usuario no lo ha dado); si dice "Ahora no" se sigue igual, solo que sin
   * pre-llenado (la IA nunca bloquea el registro). Un 200 con `ok:false` (documento
   * ilegible) se trata igual: se deja todo en blanco para llenar a mano.
   */
  async leerDocumentoAuto(): Promise<void> {
    const doc = this.fotoDe('documento');
    const persona = this.fotoDe('persona_carnet_cedula');
    if (!doc || !persona || this.leyendoDocumento()) return;
    if (!this.network.online()) {
      this.lecturaDocError.set(this.i18n.t('Necesitas conexión para leer el documento automáticamente. Llena los datos a mano.'));
      return;
    }
    if (!(await this.iaGate.pedir())) return; // CI10 — sin consentimiento: se sigue, sin pre-llenado
    this.leyendoDocumento.set(true);
    this.lecturaDocError.set('');
    try {
      const [fd, fp] = await Promise.all([this.imagenBase64(doc.blob), this.imagenBase64(persona.blob)]);
      const res = await this.service.leerDocumento(fd, fp);
      if (!res.ok || !res.lectura) {
        this.lecturaDocError.set(res.error || this.i18n.t('No se pudo leer el documento. Llena los campos a mano.'));
        return;
      }
      this.aplicarLecturaDocumento(res.lectura);
    } catch {
      this.lecturaDocError.set(this.i18n.t('No se pudo leer el documento. Llena los campos a mano.'));
    } finally {
      this.leyendoDocumento.set(false);
    }
  }

  /** Pre-llena los campos leídos (todos quedan editables). Nunca persiste la lectura cruda. */
  private aplicarLecturaDocumento(l: LecturaDocumentoPersonal): void {
    const campos: string[] = [];
    if (l.nombre) { this.nombre.set(l.nombre); campos.push(this.i18n.t('Nombre')); }
    if (l.apellido) { this.apellido.set(l.apellido); campos.push(this.i18n.t('Apellido')); }
    const nac = this.mapNacionalidad(l.nacionalidad);
    if (nac) { this.nacionalidad.set(nac); campos.push(this.i18n.t('Nacionalidad')); }
    const td = this.mapTipoDocumento(l.tipo_documento);
    if (td) { this.tipoDocumento.set(td); campos.push(this.i18n.t('Tipo de documento')); }
    if (l.documento_numero) {
      this.documentoNumero.set(l.documento_numero);
      campos.push(this.i18n.t('N° de documento'));
      void this.verificarDuplicado(); // CE16 — aviso suave de duplicado
    }
    this.lecturaDocOk.set(campos);
    this.rostroDudoso.set(l.coincide_rostro === 'no' || l.coincide_rostro === 'dudoso');
  }

  /** La edge devuelve nacionalidad libre (texto); la mapeamos al enum de la app. */
  private mapNacionalidad(raw: string | null): Nacionalidad | null {
    if (!raw) return null;
    const s = raw.toLowerCase();
    if (s.includes('domin')) return 'dominicano';
    if (s.includes('hait')) return 'haitiano';
    return 'otro';
  }

  /** 'otro' no tiene equivalente en TipoDocumento (modelo de la app): se deja sin tocar. */
  private mapTipoDocumento(raw: LecturaDocumentoPersonal['tipo_documento']): TipoDocumento | null {
    if (raw === 'cedula' || raw === 'pasaporte' || raw === 'carnet_electoral') return raw;
    return null;
  }

  /** CE16 — ya existe: marca presente hoy en vez de crear un duplicado. */
  async marcarPresenteDuplicado(personalId: string): Promise<void> {
    if (this.marcandoPresente()) return;
    this.marcandoPresente.set(true);
    try {
      await this.service.levantamientoMarcar(personalId, true);
      this.toast.success(this.i18n.t('Marcado presente hoy.'));
      void this.autosave.discard(this.clave);
      this.navGuard.back('/proyectos/personal');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo marcar presente.'));
    } finally {
      this.marcandoPresente.set(false);
    }
  }

  // ── Firma (⏸) ──────────────────────────────────────────────────────────────
  async onFirma(has: boolean): Promise<void> {
    if (!has) {
      this.firma.set(null);
      void this.borrador.removeFoto(this.clave, 'firma');
      return;
    }
    const blob = (await this.pad()?.toBlob()) ?? null;
    this.firma.set(blob);
    if (blob) void this.borrador.saveFoto(this.clave, 'firma', blob);
  }

  /**
   * CE16 — comprueba si ya existe un trabajador ACTIVO con este documento (aviso
   * suave, nunca bloquea). Best-effort + anti-carrera (token): el último resultado
   * manda. Se dispara al salir del paso de documento y al llegar al resumen.
   */
  async verificarDuplicado(): Promise<void> {
    const numero = this.documentoNumero().trim();
    if (!numero || !this.requiereDocumento()) {
      this.dupAviso.set([]);
      return;
    }
    const token = ++this.dupCheckToken;
    const hits = await this.service.docExiste(this.tipoDocumento(), numero, this.registroId());
    if (token === this.dupCheckToken) this.dupAviso.set(hits);
  }

  // ── Navegación ─────────────────────────────────────────────────────────────
  siguiente(): void {
    if (!this.pasoValido() || this.submitting()) return;
    // CE16 — al salir del paso de documento, revisa duplicados (no bloquea el avance).
    if (this.pasoActual()?.key === 'documento') void this.verificarDuplicado();
    if (this.esUltimo()) return void this.submit();
    this.paso.update((p) => Math.min(p + 1, this.pasos().length - 1));
  }

  atras(): void {
    if (this.paso() === 0) return this.intentarSalir();
    this.paso.update((p) => p - 1);
  }

  private tieneDatos(): boolean {
    return !!(
      this.proyectoId() ||
      this.nombre().trim() ||
      this.apellido().trim() ||
      this.documentoNumero().trim() ||
      this.cargoId() ||
      this.telefono().trim() ||
      this.notas().trim() ||
      this.fotosTomadas() ||
      this.firma()
    );
  }

  intentarSalir(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.finish();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.finish();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  finish(): void {
    this.navGuard.back('/proyectos/personal');
  }

  // ── Envío ──────────────────────────────────────────────────────────────────
  async submit(): Promise<void> {
    if (this.submitting() || !this.puedeRegistrar()) return;
    this.submitting.set(true);
    try {
      const fotosBlobs: Partial<Record<FotoTipo, Blob>> = {};
      for (const [tipo, foto] of Object.entries(this.fotos())) {
        if (foto) fotosBlobs[tipo as FotoTipo] = foto.blob;
      }
      await this.service.enqueueRegistro({
        id: this.registroId(),
        proyectoId: this.proyectoId(),
        nombre: this.nombre().trim(),
        apellido: this.apellido().trim() || null,
        nacionalidad: this.nacionalidad(),
        tipoDocumento: this.tipoDocumento(),
        documentoNumero: this.documentoNumero().trim() || null,
        cargoId: this.cargoId() || null,
        cuadrilla: this.cuadrilla() || null, // AV4
        aseguramientoEstado: this.aseguramiento(), // AV4
        telefono: this.telefono().trim() || null,
        notas: this.notas().trim() || null,
        fotos: fotosBlobs,
        firma: FIRMA_HABILITADA ? this.firma() : null,
        firmaDocumentoNombre: FIRMA_HABILITADA ? this.documentoFirmaNombre().trim() : null,
        // CF7 — snapshot del contrato generado con la plantilla por defecto (si la hay).
        firmaPlantillaId: FIRMA_HABILITADA ? (this.plantillaContrato()?.id ?? null) : null,
        firmaDocumentoHtml: FIRMA_HABILITADA ? (this.contratoHtml() || null) : null,
        firmaValores: FIRMA_HABILITADA && this.plantillaContrato() ? this.valoresContrato() : null,
      });
      void this.autosave.discard(this.clave); // AE9 — borrador cumplido
      this.hoja.set('exito');
      this.motion.momento('entrada'); // CL2 F4 — una persona entró al padrón (corre igual offline; ya quedó encolado)
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo registrar. Intenta de nuevo.'));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Registrar otra persona sin salir (limpia el wizard). */
  registrarOtro(): void {
    this.revocarFotos();
    this.fotos.set({});
    this.firma.set(null);
    this.nombre.set('');
    this.apellido.set('');
    this.nacionalidad.set('dominicano');
    this.tipoDocumento.set('cedula');
    this.documentoNumero.set('');
    this.cargoId.set('');
    this.cuadrilla.set('');
    this.aseguramiento.set('desconocido');
    this.telefono.set('');
    this.notas.set('');
    this.registroId.set(crypto.randomUUID());
    this.modoRegistro.set('completo');
    this.lecturaDocError.set('');
    this.lecturaDocOk.set([]);
    this.rostroDudoso.set(false);
    this.dupAviso.set([]);
    this.paso.set(0);
    this.hydrated = true;
    this.hoja.set('form');
  }
}
