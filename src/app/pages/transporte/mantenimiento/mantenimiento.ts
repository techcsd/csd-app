import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { TallerPicker, TallerSel } from '../../../shared/ui/taller-picker/taller-picker';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { CapturedPhoto, CameraService } from '../../../core/services/camera.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoDetalle } from '../../../core/models/transporte.model';
import {
  MantenimientosService,
  MantenimientoTipo,
  ADJUNTO_TIPO_LABEL,
  AdjuntoTipoDocumento,
  ProveedorFlota,
  ValidacionKm,
} from '../../../core/services/mantenimientos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { fechaLocalISO } from '../../../core/util/fecha';

interface TipoOpcion {
  valor: MantenimientoTipo;
  label: string;
  icon: string;
  tone: 'default' | 'success' | 'warning' | 'error';
}

// X6-app / AG9 / AL7 — tipos de visita, alineados con el servidor (crear_mantenimiento_app).
// AL7 — el chofer registra desde rutina hasta tintado/bombillo/gomas del vehículo en uso.
const TIPOS: TipoOpcion[] = [
  { valor: 'preventivo', label: 'Mantenimiento de rutina', icon: '🛠️', tone: 'success' },
  { valor: 'reparacion', label: 'Reparación', icon: '🔧', tone: 'warning' },
  { valor: 'falla', label: 'Falla / avería', icon: '⚠️', tone: 'warning' },
  { valor: 'accidente_dano', label: 'Accidente o daño', icon: '🚨', tone: 'error' },
  { valor: 'cambio_pieza', label: 'Cambio de pieza', icon: '🔩', tone: 'default' },
  { valor: 'tintado', label: 'Tintado de cristales', icon: '🪟', tone: 'default' },
  { valor: 'bombillo', label: 'Cambio de bombillo', icon: '💡', tone: 'default' },
  { valor: 'neumatico', label: 'Neumáticos / gomas', icon: '🛞', tone: 'default' },
  { valor: 'bateria', label: 'Batería', icon: '🔋', tone: 'default' },
  { valor: 'engrase', label: 'Engrase', icon: '🛢️', tone: 'default' },
  { valor: 'hidraulico', label: 'Hidráulico', icon: '💧', tone: 'default' },
  { valor: 'lavado', label: 'Lavado', icon: '🧼', tone: 'default' },
  { valor: 'otros', label: 'Otros servicios', icon: '✨', tone: 'default' },
];

const TOTAL_STEPS = 4;
const MAX_FOTOS = 3;

/**
 * Report a vehicle maintenance (mantenimiento) from the field: type,
 * description, optional km + up to 3 photos. Saved offline via the outbox.
 * Mirrors the pre-use checklist wizard.
 */
@Component({
  selector: 'app-mantenimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, BigConfirm, Skeleton, WizardFooter, ConfirmDialog, WizardExit, KmInput, TallerPicker, VoiceNotes, TranslatePipe],
  templateUrl: './mantenimiento.html',
  styleUrl: './mantenimiento.scss',
})
export class MantenimientoPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private mantenimientos = inject(MantenimientosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private location = inject(Location);
  private i18n = inject(I18nService);
  private camera = inject(CameraService);

  readonly total = TOTAL_STEPS;
  readonly maxFotos = MAX_FOTOS;
  readonly tipos = TIPOS;
  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  vehiculoId = '';
  /** AG15 — tarea que originó este mantenimiento (se enlaza al crear). */
  private tareaVinculada: string | null = null;
  placa = signal('');
  modelo = signal('');
  vehDetalle = signal<VehiculoDetalle | null>(null); // U15 — odómetro + mantenimiento
  odometro = computed(() => this.vehDetalle()?.kilometraje ?? null);
  /** CH1 — unidad del vehículo (h para horómetro, km para el resto). */
  unidad = computed(() => (this.vehDetalle()?.medida_uso === 'horas' ? 'h' : 'km'));
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo

  step = signal(1);
  tipo = signal<MantenimientoTipo | null>(null);
  incluyePreventivo = signal(false); // X6-app — solo en visitas no preventivas
  descripcion = signal('');
  km = signal<number | null>(null);
  costo = signal<number | null>(null); // AL7 — opcional
  taller = signal(''); // AL7/CH2 — nombre del taller/proveedor (del maestro o libre)
  tallerId = signal<string | null>(null); // CH2 — id del maestro (null = "Otro")
  notas = signal(''); // AL7 — notas del trabajo
  fotos = signal<Record<number, CapturedPhoto>>({});
  voces = signal<VoiceNoteItem[]>([]); // Z23 — notas de voz

  // CG13 — documentos del taller (PDF o foto) con tipo de documento; se encolan como
  // adjuntos tras crear el mantenimiento. El flujo típico de Raykler: un correctivo
  // con la factura/informe del taller en PDF.
  readonly docTipos: AdjuntoTipoDocumento[] = ['factura', 'informe', 'cotizacion', 'garantia', 'foto', 'otro'];
  docTipoLabel = (t: string): string => ADJUNTO_TIPO_LABEL[t as AdjuntoTipoDocumento] ?? t;
  // CH3 — cada documento lleva su tipo (editable) y, si es "otro", una descripción.
  documentos = signal<Array<{ blob: Blob; nombre: string; mime: string; tipoDocumento: string; descripcion?: string }>>([]);
  // CH3 — índice del documento cuyo tipo se está cambiando (hoja de tipos).
  editandoDocIdx = signal<number | null>(null);

  // ── CH2 — taller / proveedor del maestro (cacheado offline) ──────────────────
  talleres = signal<ProveedorFlota[]>([]);

  // ── CH1 — validación del km contra las lecturas del vehículo (online) ────────
  kmValidacion = signal<ValidacionKm | null>(null);
  kmConfirmado = signal(false);
  private kmValTimer: ReturnType<typeof setTimeout> | null = null;

  /** X6-app — el checkbox "incluyó preventivo" solo aplica si NO es preventivo. */
  mostrarIncluyePreventivo = computed(() => {
    const t = this.tipo();
    return !!t && t !== 'preventivo';
  });

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false); // Q7
  borradorPrevio = signal(false);
  private hydrated = false;

  /** CH1 — fallback offline: solo bloquea si el km es MENOR al odómetro cacheado
   *  (el mantenimiento de la app es siempre de hoy). Online manda `validar_km_vehiculo`. */
  kmMenorOdometro = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });

  /** CH1 — ¿el servidor bloquea el km? (retroceso/exceso). Solo cuando hay veredicto. */
  kmBloqueado = computed(() => {
    if (this.online) return this.kmValidacion()?.nivel === 'error';
    return this.kmMenorOdometro(); // offline: regla local
  });

  /** CH1 — mensaje a mostrar al bloquear el avance. */
  kmMensajeBloqueo(): string {
    const v = this.kmValidacion();
    if (this.online && v?.nivel === 'error' && v.mensaje) return v.mensaje;
    return this.i18n.t('La lectura no puede ser menor a la registrada ({km} {u}).', { km: this.odometro() ?? '', u: this.unidad() });
  }

  private get clave(): string {
    return `mantenimiento:${this.vehiculoId}`;
  }

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    // AG15 — si se abrió desde una tarea vinculada, recuérdala para enlazar al crear.
    this.tareaVinculada = this.route.snapshot.queryParamMap.get('tarea');
    void this.loadVehiculo();
    void this.loadTalleres(); // CH2 — lista de talleres (cacheada offline)
    void this.restoreDraft();
    this.navGuard.register(this.backHandler); // Q7 — botón físico Android
    // U15 — autosave (regla: todo formulario lo tiene).
    effect(() => {
      const snap = { tipo: this.tipo(), incluyePreventivo: this.incluyePreventivo(), descripcion: this.descripcion(), km: this.km(), costo: this.costo(), taller: this.taller(), tallerId: this.tallerId(), notas: this.notas(), step: this.step() };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'mantenimiento', etiqueta: this.i18n.t('Mantenimiento'), ruta: this.location.path() });
    });
    // CH1 — valida el km contra las lecturas del vehículo (online, con debounce).
    // Reinicia la confirmación del salto cuando cambia el km/vehículo.
    effect(() => {
      const km = this.km();
      const on = this.network.online();
      untracked(() => this.kmConfirmado.set(false));
      if (this.kmValTimer) clearTimeout(this.kmValTimer);
      if (!on || km == null || !this.vehiculoId) {
        untracked(() => this.kmValidacion.set(null));
        return;
      }
      this.kmValTimer = setTimeout(() => void this.validarKm(km), 400);
    });
  }

  private async loadTalleres(): Promise<void> {
    try {
      this.talleres.set(await this.mantenimientos.talleresYProveedores());
    } catch {
      this.talleres.set([]); // offline sin caché: el picker solo ofrece "Otro"
    }
  }

  /** CH1 — pide el veredicto del km al servidor (ignora fallos: cae a la regla local). */
  private async validarKm(km: number): Promise<void> {
    try {
      this.kmValidacion.set(await this.mantenimientos.validarKm(this.vehiculoId, km, fechaLocalISO()));
    } catch {
      this.kmValidacion.set(null);
    }
  }

  /** CH2 — el picker eligió un taller del maestro o escribió uno libre ("Otro"). */
  onTallerChanged(sel: TallerSel): void {
    this.tallerId.set(sel.id);
    this.taller.set(sel.nombre ?? '');
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async restoreDraft(): Promise<void> {
    const draft = await this.borrador.load<{ tipo: MantenimientoTipo | null; incluyePreventivo?: boolean; descripcion: string; km: number | null; costo?: number | null; taller?: string; tallerId?: string | null; notas?: string; step: number }>(this.clave);
    if (draft) {
      this.tipo.set(draft.tipo ?? null);
      this.incluyePreventivo.set(draft.incluyePreventivo ?? false);
      this.descripcion.set(draft.descripcion ?? '');
      this.km.set(draft.km ?? null);
      this.costo.set(draft.costo ?? null);
      this.taller.set(draft.taller ?? '');
      this.tallerId.set(draft.tallerId ?? null);
      this.notas.set(draft.notas ?? '');
      const fotos = await this.borrador.loadFotos(this.clave);
      if (fotos.length) {
        const map: Record<number, CapturedPhoto> = {};
        for (const f of fotos) {
          const idx = Number(f.slot);
          if (Number.isFinite(idx)) map[idx] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        }
        this.fotos.set(map);
      }
      this.borradorPrevio.set(true);
    }
    this.hydrated = true;
  }

  /** Q7 — ¿hay datos sin guardar? */
  private tieneDatos(): boolean {
    return (
      !!this.tipo() ||
      !!this.descripcion().trim() ||
      this.km() != null ||
      Object.keys(this.fotos()).length > 0
    );
  }

  intentarSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.salir();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
  private salir(): void {
    // S31 — location.back() vuelve al hub sin duplicarlo (atrás llega a home).
    this.location.back();
  }

  private async loadVehiculo(): Promise<void> {
    try {
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
      }
      // U15 — detalle con km EFECTIVO + mantenimiento para el KmInput en vivo.
      void this.vehiculos.getVehiculoDetalle(this.vehiculoId).then((d) => this.vehDetalle.set(d));
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(): string {
    return this.tipos.find((t) => t.valor === this.tipo())?.label ?? '';
  }

  fotosCount(): number {
    return Object.keys(this.fotos()).length;
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
    void this.borrador.saveFoto(this.clave, String(idx), photo.blob); // U15 — persistir
  }

  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
    void this.borrador.removeFoto(this.clave, String(idx));
  }

  // ── CG13/CH3 — documentos del taller (PDF/foto), tipo POR documento ──────────
  /** CH3 — infiere el tipo inicial por mime/nombre (igual que la web). */
  private inferirTipoDoc(nombre: string, mime: string): AdjuntoTipoDocumento {
    if (mime.startsWith('image/')) return 'foto';
    const n = (nombre || '').toLowerCase();
    if (/fact|fac|invoice|ncf/.test(n)) return 'factura';
    if (/cot/.test(n)) return 'cotizacion';
    if (/inf|reporte/.test(n)) return 'informe';
    return 'factura';
  }

  async elegirDocumento(): Promise<void> {
    const doc = await this.camera.pickDocument();
    if (!doc) return;
    if (doc.blob.size > 15 * 1024 * 1024) {
      this.toast.error(this.i18n.t('El archivo supera el máximo de 15 MB.'));
      return;
    }
    const mime = doc.esImagen ? 'image/jpeg' : 'application/pdf';
    // CH3 — se agrega directo con el tipo inferido; se puede cambiar en la lista.
    this.documentos.update((l) => [...l, { blob: doc.blob, nombre: doc.nombre, mime, tipoDocumento: this.inferirTipoDoc(doc.nombre, mime), descripcion: '' }]);
  }
  quitarDocumento(i: number): void {
    this.documentos.update((l) => l.filter((_, idx) => idx !== i));
  }
  /** CH3 — abre la hoja para cambiar el tipo del documento `i`. */
  editarTipoDoc(i: number): void {
    this.editandoDocIdx.set(i);
  }
  cancelarEditarTipo(): void {
    this.editandoDocIdx.set(null);
  }
  /** CH3 — fija el tipo del documento en edición (limpia la descripción si deja de ser "otro"). */
  setTipoDoc(tipo: AdjuntoTipoDocumento): void {
    const i = this.editandoDocIdx();
    if (i == null) return;
    this.documentos.update((l) => l.map((d, idx) => (idx === i ? { ...d, tipoDocumento: tipo, descripcion: tipo === 'otro' ? d.descripcion : '' } : d)));
    this.editandoDocIdx.set(null);
  }
  /** CH3 — descripción del documento cuando el tipo es "otro". */
  setDocDescripcion(i: number, desc: string): void {
    this.documentos.update((l) => l.map((d, idx) => (idx === i ? { ...d, descripcion: desc } : d)));
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Per-step gate so the user can't skip required fields. */
  canAdvance(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.tipo()) {
          this.toast.error(this.i18n.t('Elige el tipo de mantenimiento.'));
          return false;
        }
        return true;
      case 2:
        if (!this.descripcion().trim()) {
          this.toast.error(this.i18n.t('Describe el mantenimiento.'));
          return false;
        }
        if (this.kmBloqueado()) {
          this.toast.error(this.kmMensajeBloqueo());
          return false;
        }
        if (this.online && this.kmValidacion()?.nivel === 'aviso' && !this.kmConfirmado()) {
          this.toast.error(this.i18n.t('Confirma el kilometraje marcado o corrígelo.'));
          return false;
        }
        return true;
      case 3:
        if (this.fotosCount() < 1) {
          this.toast.error(this.i18n.t('Adjunta al menos 1 foto del mantenimiento.'));
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.tipo()) {
      this.toast.error(this.i18n.t('Elige el tipo de mantenimiento.'));
      return;
    }
    const descripcion = this.descripcion().trim();
    if (!descripcion) {
      this.toast.error(this.i18n.t('Describe el mantenimiento.'));
      return;
    }
    if (this.kmBloqueado()) {
      this.toast.error(this.kmMensajeBloqueo());
      return;
    }
    if (this.online && this.kmValidacion()?.nivel === 'aviso' && !this.kmConfirmado()) {
      this.toast.error(this.i18n.t('Confirma el kilometraje marcado o corrígelo.'));
      return;
    }
    if (this.fotosCount() < 1) {
      this.toast.error(this.i18n.t('Adjunta al menos 1 foto del mantenimiento.'));
      return;
    }
    // CH3 — un documento tipo "Otro" necesita decir QUÉ es (paridad con el taller "Otro").
    if (this.documentos().some((d) => d.tipoDocumento === 'otro' && !(d.descripcion ?? '').trim())) {
      this.toast.error(this.i18n.t('Escribe qué documento es el que marcaste como "Otro".'));
      return;
    }
    this.submitting.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots
        .map((i) => fotosMap[i]?.blob)
        .filter((b): b is Blob => !!b);

      await this.mantenimientos.enqueueMantenimiento({
        vehiculoId: this.vehiculoId,
        tipo: this.tipo()!,
        // Solo tiene sentido en visitas no preventivas (guarda anti-inconsistencia).
        incluyePreventivo: this.mostrarIncluyePreventivo() && this.incluyePreventivo(),
        descripcion,
        fecha: fechaLocalISO(), // BL9 — día LOCAL (RD, UTC-4)
        km: this.km(),
        costo: this.costo() != null ? Math.max(0, this.costo()!) : null, // AL7 (QA-23: sin negativos, igual que el cierre)
        proveedor: this.taller().trim() || null, // AL7/CH2 (nombre)
        proveedorId: this.tallerId(), // CH2 (id del maestro; null = "Otro")
        notas: this.notas().trim() || null, // AL7
        fotos,
        adjuntos: this.documentos(), // CG13/CH3 — PDF/foto del taller (con tipo + descripción)
        voces: this.voces().map((n) => n.blob),
        placa: this.placa(),
        tareaVinculada: this.tareaVinculada, // AG15
      });
      await this.autosave.discard(this.clave); // limpia borrador + fotos
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar. Intenta de nuevo.'));
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
