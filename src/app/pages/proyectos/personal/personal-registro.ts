import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
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

import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { PersonalObraService } from '../../../core/services/personal-obra.service';
import {
  Cargo,
  FotoTipo,
  FOTOS_GUIA,
  NACIONALIDADES,
  TIPOS_DOCUMENTO,
  Nacionalidad,
  TipoDocumento,
  PersonalObra,
} from '../../../core/models/personal-obra.model';

/** URL base de la web SGC (verificación del carnet por QR → expediente web). */
const SGC_WEB = 'https://sgcconstructorasd.com';

/** ⏸ AR1 — el paso de firma de documentos está en PAUSA (Xaviel lo define). Cuando
 *  se active, poner en true: el wizard inserta el paso y el servicio ya sube la
 *  firma por outbox (sin rehacer nada). */
const FIRMA_HABILITADA = false;

/** AR1 — hojas del wizard de registro de personal (una pregunta por pantalla). */
type PasoKey = 'datos' | 'documento' | 'fotos' | 'firma' | 'carnet' | 'resumen';

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
  ],
  templateUrl: './personal-registro.html',
  styleUrl: './personal-registro.scss',
})
export class PersonalRegistroPage implements OnDestroy {
  private service = inject(PersonalObraService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private toast = inject(ToastService);

  readonly nacionalidades = NACIONALIDADES;
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly firmaHabilitada = FIRMA_HABILITADA;
  /** Guía de la foto del documento (paso 2). */
  readonly guiaDocumento = FOTOS_GUIA.find((g) => g.tipo === 'documento')!;
  /** Fotos guiadas del paso 3 (todas menos el documento, que va en el paso 2). */
  readonly guiaFotos = FOTOS_GUIA.filter((g) => g.tipo !== 'documento');

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
  telefono = signal('');
  notas = signal('');

  // Fotos (mapa tipo → foto capturada). El padre es dueño de las object-URL.
  fotos = signal<Partial<Record<FotoTipo, CapturedPhoto>>>({});
  // ⏸ Firma
  firma = signal<Blob | null>(null);
  documentoFirmaNombre = signal('Acuerdo de registro de personal de obra');

  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  cargoOptions = computed(() => this.cargos().map((c) => ({ id: c.id, label: `${c.nombre} · ${c.codigo}` })));

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
    const p: { key: PasoKey; titulo: string }[] = [
      { key: 'datos', titulo: 'Datos de la persona' },
      { key: 'documento', titulo: 'Documento de identidad' },
      { key: 'fotos', titulo: 'Fotos de evidencia' },
    ];
    if (FIRMA_HABILITADA) p.push({ key: 'firma', titulo: 'Firma del documento' });
    p.push({ key: 'carnet', titulo: 'Carnet' });
    p.push({ key: 'resumen', titulo: 'Revisar y registrar' });
    return p;
  });

  pasoActual = computed(() => this.pasos()[Math.min(this.paso(), this.pasos().length - 1)]);
  esUltimo = computed(() => this.paso() >= this.pasos().length - 1);

  pasoValido = computed(() => {
    switch (this.pasoActual()?.key) {
      case 'datos':
        return !!(this.proyectoId() && this.nombre().trim() && this.nacionalidad() && this.cargoId());
      case 'documento':
        return !this.requiereDocumento() || !!this.fotos()['documento'];
      case 'fotos':
        return !!this.fotos()['persona'];
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

  puedeRegistrar = computed(
    () =>
      !!(
        this.proyectoId() &&
        this.nombre().trim() &&
        this.nacionalidad() &&
        this.cargoId() &&
        this.fotos()['persona'] &&
        (!this.requiereDocumento() || this.fotos()['documento'])
      ),
  );

  primaryBtn = computed(() => {
    if (this.submitting()) return 'Registrando…';
    return this.esUltimo() ? 'Registrar' : 'Siguiente';
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
      telefono: this.telefono(),
      notas: this.notas(),
    };
    if (!this.hydrated || this.hoja() === 'exito' || this.submitting()) return;
    if (!this.tieneDatos()) return;
    this.autosave.queue(this.clave, snap, {
      tipo: 'personal',
      etiqueta: 'Registro de personal',
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

  // ── Navegación ─────────────────────────────────────────────────────────────
  siguiente(): void {
    if (!this.pasoValido() || this.submitting()) return;
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
        telefono: this.telefono().trim() || null,
        notas: this.notas().trim() || null,
        fotos: fotosBlobs,
        firma: FIRMA_HABILITADA ? this.firma() : null,
        firmaDocumentoNombre: FIRMA_HABILITADA ? this.documentoFirmaNombre().trim() : null,
      });
      void this.autosave.discard(this.clave); // AE9 — borrador cumplido
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar. Intenta de nuevo.');
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
    this.telefono.set('');
    this.notas.set('');
    this.registroId.set(crypto.randomUUID());
    this.paso.set(0);
    this.hydrated = true;
    this.hoja.set('form');
  }
}
