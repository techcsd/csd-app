import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { Counter } from '../../../shared/ui/counter/counter';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VoiceRecorder } from '../../../shared/ui/voice-recorder/voice-recorder';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { BorradorService } from '../../../core/services/borrador.service';
import {
  INCIDENTE_GRAVEDADES,
  INCIDENTE_TIPOS,
  IncidenteTipo,
  Proyecto,
} from '../../../core/models/bitacora.model';

const TOTAL = 7;
const MIN_FOTOS = 1; // S6 — el RPC exige ≥1 foto en incidentes.

/**
 * S11/S12/S13 — reporte de incidencia tipo hojas (patrón del parte): obra → tipo
 * → preguntas del tipo → ¿qué pasó? (sucesos + Otro) → fotos/voz → acciones →
 * resumen. Los tres tipos (incidente/accidente/incidente de equipo) cambian las
 * preguntas del paso 3.
 */
@Component({
  selector: 'app-incidente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, WizardFooter, OptionButton, Counter, BigConfirm, ConfirmDialog, VoiceRecorder, Skeleton],
  templateUrl: './incidente.html',
  styleUrl: './incidente.scss',
})
export class IncidentePage implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);
  private borrador = inject(BorradorService);

  readonly total = TOTAL;
  readonly minFotos = MIN_FOTOS;
  readonly tipos = INCIDENTE_TIPOS;
  readonly gravedades = INCIDENTE_GRAVEDADES;

  private draftKey = '';
  private hydrated = false;

  step = signal(1);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  proyectoId = signal('');
  tipo = signal<IncidenteTipo | null>(null);
  gravedad = signal<string>('');
  lesionados = signal(0);
  subcontratista = signal('');
  // S12 — incidente de equipo.
  equipoNombre = signal('');
  equipoAlquilado = signal<boolean | null>(null);
  equipoOperativo = signal<boolean | null>(null);
  // S13 — sucesos probables ("¿qué pasó?") del catálogo + "Otro".
  sucesos = signal<string[]>([]);
  suceso = signal<string>('');
  otroActivo = signal(false);
  sucesoOtro = signal('');
  // Acciones tomadas.
  acciones = signal('');
  voz = signal<Blob | null>(null);
  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  hayHeridos = computed(() => this.lesionados() > 0);
  esAccidente = computed(() => this.tipo() === 'accidente');
  esEquipo = computed(() => this.tipo() === 'incidente_equipo');

  proyectoNombre = computed(
    () => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '',
  );
  tipoLabel = computed(() => this.tipos.find((t) => t.value === this.tipo())?.label ?? '');

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.load();
    this.navGuard.register(this.backHandler); // botón físico Android
    // Q7 — autosave del borrador (recupera tras kill/salida).
    effect(() => {
      const snap = {
        proyectoId: this.proyectoId(),
        tipo: this.tipo(),
        gravedad: this.gravedad(),
        lesionados: this.lesionados(),
        subcontratista: this.subcontratista(),
        equipoNombre: this.equipoNombre(),
        equipoAlquilado: this.equipoAlquilado(),
        equipoOperativo: this.equipoOperativo(),
        suceso: this.suceso(),
        otroActivo: this.otroActivo(),
        sucesoOtro: this.sucesoOtro(),
        acciones: this.acciones(),
        step: this.step(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.tieneDatos()) return;
      void this.borrador.save(this.draftKey, snap, {
        tipo: 'incidente',
        etiqueta: 'Reporte de incidente' + (this.proyectoNombre() ? ' · ' + this.proyectoNombre() : ''),
        ruta: '/bitacora/incidente',
      });
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.bitacora.getProyectos();
      this.proyectos.set(list);

      const claveParam = this.route.snapshot.queryParamMap.get('borrador');
      const draft = claveParam ? await this.borrador.load<IncidenteDraft>(claveParam) : null;
      this.draftKey = draft && claveParam ? claveParam : `incidente:${crypto.randomUUID()}`;

      if (draft) {
        this.proyectoId.set(draft.proyectoId);
        this.tipo.set(draft.tipo ?? null);
        this.gravedad.set(draft.gravedad ?? '');
        this.lesionados.set(draft.lesionados ?? 0);
        this.subcontratista.set(draft.subcontratista ?? '');
        this.equipoNombre.set(draft.equipoNombre ?? '');
        this.equipoAlquilado.set(draft.equipoAlquilado ?? null);
        this.equipoOperativo.set(draft.equipoOperativo ?? null);
        this.suceso.set(draft.suceso ?? '');
        this.otroActivo.set(draft.otroActivo ?? false);
        this.sucesoOtro.set(draft.sucesoOtro ?? '');
        this.acciones.set(draft.acciones ?? '');
        this.step.set(draft.step ?? 1);
        if (draft.tipo) void this.loadSucesos(draft.tipo);
        this.toast.show('Recuperamos tu reporte a medio llenar. Las fotos y la nota de voz hay que tomarlas de nuevo.', 'info', 4500);
      } else {
        const obra = this.ctx.obraActiva();
        if (obra) this.proyectoId.set(obra.id);
        else if (list.length === 1) this.proyectoId.set(list[0].id);
      }
    } finally {
      this.loading.set(false);
      this.hydrated = true;
    }
  }

  /** S13 — carga los sucesos del catálogo según el tipo elegido. */
  private async loadSucesos(tipo: IncidenteTipo): Promise<void> {
    this.sucesos.set(await this.bitacora.getSucesos(tipo));
  }

  pickTipo(t: IncidenteTipo): void {
    if (this.tipo() === t) return;
    this.tipo.set(t);
    // Reinicia lo que depende del tipo.
    this.suceso.set('');
    this.otroActivo.set(false);
    this.sucesoOtro.set('');
    void this.loadSucesos(t);
  }

  pickSuceso(s: string): void {
    this.suceso.set(s);
    this.otroActivo.set(false);
  }

  pickOtro(): void {
    this.otroActivo.set(true);
    this.suceso.set('');
  }

  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) this.fotos.update((f) => [...f, photo]);
    } finally {
      this.capturing.set(false);
    }
  }

  async addFromGallery(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photos = await this.camera.pickFromGallery();
      if (photos.length) this.fotos.update((f) => [...f, ...photos]);
    } finally {
      this.capturing.set(false);
    }
  }

  removeFoto(i: number): void {
    const f = this.fotos()[i];
    if (f) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((list) => list.filter((_, idx) => idx !== i));
  }

  get online(): boolean {
    return this.network.online();
  }

  // ── Navegación (footer) ────────────────────────────────────────────────────

  primaryLabel = computed(() =>
    this.step() >= this.total ? (this.submitting() ? 'Guardando…' : 'Enviar reporte') : 'Siguiente',
  );
  backLabel = computed(() => (this.step() > 1 ? 'Atrás' : 'Cancelar'));
  primaryDisabled = computed(() => this.step() >= this.total && this.submitting());

  onPrimary(): void {
    if (this.step() >= this.total) {
      void this.submit();
      return;
    }
    this.next();
  }

  onBack(): void {
    if (this.step() > 1) this.step.update((s) => s - 1);
    else this.salir();
  }

  private next(): void {
    const s = this.step();
    if (s === 1 && !this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    if (s === 2 && !this.tipo()) {
      this.toast.error('Elige el tipo de reporte.');
      return;
    }
    if (s === 3) {
      if (this.esEquipo()) {
        if (!this.equipoNombre().trim()) {
          this.toast.error('Dinos cuál equipo.');
          return;
        }
        if (this.equipoAlquilado() === null) {
          this.toast.error('Dinos si el equipo es alquilado o propio.');
          return;
        }
        if (this.equipoOperativo() === null) {
          this.toast.error('Dinos si el equipo queda operativo.');
          return;
        }
      } else if (!this.gravedad()) {
        this.toast.error('Elige la gravedad.');
        return;
      }
    }
    if (s === 4 && !this.suceso() && !(this.otroActivo() && this.sucesoOtro().trim())) {
      this.toast.error('Dinos qué pasó (elige una opción u "Otro").');
      return;
    }
    if (s === 5 && this.fotos().length < MIN_FOTOS) {
      this.toast.error(`Agrega al menos ${MIN_FOTOS} foto.`);
      return;
    }
    this.step.update((x) => Math.min(this.total, x + 1));
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId() || !this.tipo()) {
      this.toast.error('Faltan datos del reporte.');
      return;
    }
    if (this.fotos().length < MIN_FOTOS) {
      this.toast.error(`Agrega al menos ${MIN_FOTOS} foto.`);
      this.step.set(5);
      return;
    }
    const descripcion = (this.otroActivo() ? this.sucesoOtro() : this.suceso()).trim() || null;
    this.submitting.set(true);
    try {
      await this.bitacora.enqueueIncidente({
        proyectoId: this.proyectoId(),
        tipo: this.tipo()!,
        gravedad: this.gravedad() || (this.esEquipo() ? 'moderado' : ''),
        lesionados: this.esAccidente() ? this.lesionados() : 0,
        descripcion,
        acciones: this.acciones().trim() || null,
        subcontratista: this.esAccidente() ? this.subcontratista().trim() || null : null,
        suceso: this.otroActivo() ? null : this.suceso() || null,
        equipoNombre: this.esEquipo() ? this.equipoNombre().trim() || null : null,
        equipoAlquilado: this.esEquipo() ? this.equipoAlquilado() : null,
        equipoOperativo: this.esEquipo() ? this.equipoOperativo() : null,
        fotos: this.fotos().map((f) => f.blob),
        voz: this.voz(),
      });
      this.hydrated = false;
      await this.borrador.clear(this.draftKey);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    for (const f of this.fotos()) URL.revokeObjectURL(f.previewUrl);
  }

  private tieneDatos(): boolean {
    return (
      !this.done() &&
      (this.step() > 1 ||
        !!this.tipo() ||
        !!this.gravedad() ||
        this.lesionados() > 0 ||
        !!this.subcontratista().trim() ||
        !!this.equipoNombre().trim() ||
        !!this.suceso() ||
        !!this.sucesoOtro().trim() ||
        !!this.acciones().trim() ||
        this.fotos().length > 0 ||
        !!this.voz())
    );
  }

  salir(): void {
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
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }
}

/** Forma persistida del borrador del incidente. */
interface IncidenteDraft {
  proyectoId: string;
  tipo: IncidenteTipo | null;
  gravedad: string;
  lesionados: number;
  subcontratista: string;
  equipoNombre: string;
  equipoAlquilado: boolean | null;
  equipoOperativo: boolean | null;
  suceso: string;
  otroActivo: boolean;
  sucesoOtro: string;
  acciones: string;
  step: number;
}
