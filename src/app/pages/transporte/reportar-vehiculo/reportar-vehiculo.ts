import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { Counter } from '../../../shared/ui/counter/counter';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CameraService, CapturedDoc, CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { FlotaReportesService } from '../../../core/services/flota-reportes.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { ZONAS_DANO } from '../../../core/models/transporte.model';
import { ACCIDENTE_FASES, AccidenteFase, DanoOrigen } from '../../../core/models/flota-reportes.model';

type Tipo = 'accidente' | 'dano';

/** Estado del formulario persistido (los blobs de fotos van aparte). */
interface ReporteVehDraft {
  tipo: Tipo | null;
  step: number;
  fase: AccidenteFase | null;
  descripcion: string;
  lesionados: number;
  tercero: string;
  ametMeta: { ext: string; nombre: string; esImagen: boolean } | null;
  zona: string;
  danoDescripcion: string;
  danoOrigen: DanoOrigen;
  tieneDanoFoto: boolean;
}

/**
 * S22 — reportar accidente o daño de un vehículo, tipo hoja. Un asunto por
 * pantalla; por outbox (registrar_accidente_app / registrar_dano_app). La
 * ubicación se captura en paralelo desde el inicio.
 */
@Component({
  selector: 'app-reportar-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, WizardFooter, OptionButton, Counter, PhotoSlot, BigConfirm, ConfirmDialog],
  templateUrl: './reportar-vehiculo.html',
  styleUrl: './reportar-vehiculo.scss',
})
export class ReportarVehiculoPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private reportes = inject(FlotaReportesService);
  private permissions = inject(PermissionsService);
  private camera = inject(CameraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private location = inject(Location);

  readonly fases = ACCIDENTE_FASES;
  readonly zonas = ZONAS_DANO;

  vehiculoId = '';
  placa = signal('');
  step = signal(1);
  tipo = signal<Tipo | null>(null);

  // Accidente
  fase = signal<AccidenteFase | null>(null);
  descripcion = signal('');
  lesionados = signal(0);
  tercero = signal('');
  amet = signal<CapturedDoc | null>(null);
  private gps: { lat: number; lng: number } | null = null;

  // Daño
  zona = signal<string>('frente');
  danoDescripcion = signal('');
  danoOrigen = signal<DanoOrigen>('desconocido');
  danoFoto = signal<CapturedPhoto | null>(null);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  borradorPrevio = signal(false);
  private hydrated = false;

  private get clave(): string {
    return `reporte_vehiculo:${this.vehiculoId}`;
  }

  total = computed(() => (this.tipo() === 'accidente' ? 5 : this.tipo() === 'dano' ? 4 : 1));
  esAccidente = computed(() => this.tipo() === 'accidente');

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.load();
    void this.restoreDraft();
    void this.captureGps(); // S28 — ubicación en paralelo desde el inicio
    this.navGuard.register(this.backHandler);
    // U9 — autosave del formulario (regla: todo formulario lo tiene).
    effect(() => {
      const snap: ReporteVehDraft = {
        tipo: this.tipo(),
        step: this.step(),
        fase: this.fase(),
        descripcion: this.descripcion(),
        lesionados: this.lesionados(),
        tercero: this.tercero(),
        ametMeta: this.amet() ? { ext: this.amet()!.ext, nombre: this.amet()!.nombre, esImagen: this.amet()!.esImagen } : null,
        zona: this.zona(),
        danoDescripcion: this.danoDescripcion(),
        danoOrigen: this.danoOrigen(),
        tieneDanoFoto: !!this.danoFoto(),
      };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'reporte_vehiculo', etiqueta: 'Accidente o daño', ruta: this.location.path() });
    });
  }

  private async restoreDraft(): Promise<void> {
    const draft = await this.borrador.load<ReporteVehDraft>(this.clave);
    if (draft) {
      this.tipo.set(draft.tipo);
      this.step.set(draft.step || 1);
      this.fase.set(draft.fase);
      this.descripcion.set(draft.descripcion ?? '');
      this.lesionados.set(draft.lesionados ?? 0);
      this.tercero.set(draft.tercero ?? '');
      this.zona.set(draft.zona ?? 'frente');
      this.danoDescripcion.set(draft.danoDescripcion ?? '');
      this.danoOrigen.set(draft.danoOrigen ?? 'desconocido');
      const fotos = await this.borrador.loadFotos(this.clave);
      if (draft.ametMeta) {
        const f = fotos.find((x) => x.slot === 'amet');
        if (f) {
          this.amet.set({
            blob: f.blob,
            nombre: draft.ametMeta.nombre,
            esImagen: draft.ametMeta.esImagen,
            ext: draft.ametMeta.ext,
            previewUrl: draft.ametMeta.esImagen ? URL.createObjectURL(f.blob) : null,
          });
        }
      }
      if (draft.tieneDanoFoto) {
        const f = fotos.find((x) => x.slot === 'dano');
        if (f) this.danoFoto.set({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) });
      }
      this.borradorPrevio.set(true);
    }
    this.hydrated = true;
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async load(): Promise<void> {
    const v = await this.vehiculos.getVehiculo(this.vehiculoId);
    if (v) this.placa.set(v.placa);
  }

  private async captureGps(): Promise<void> {
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 20000, maximumAge: 60000 });
    this.gps = r.ok ? { lat: r.lat, lng: r.lng } : null;
  }

  pickTipo(t: Tipo): void {
    this.tipo.set(t);
  }

  async subirAmet(desdeArchivo: boolean): Promise<void> {
    // U9 — persistir el borrador ANTES de abrir el picker (MIUI recrea la Activity).
    await this.autosave.flushAll();
    const doc = desdeArchivo ? await this.camera.pickDocument() : await this.camera.takeDocumentPhoto();
    if (doc) {
      this.amet.set(doc);
      await this.borrador.saveFoto(this.clave, 'amet', doc.blob);
    }
  }
  async quitarAmet(): Promise<void> {
    const prev = this.amet();
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    this.amet.set(null);
    await this.borrador.removeFoto(this.clave, 'amet');
  }

  onDanoFoto(photo: CapturedPhoto): void {
    this.danoFoto.set(photo);
    void this.borrador.saveFoto(this.clave, 'dano', photo.blob);
  }
  onDanoFotoCleared(): void {
    this.danoFoto.set(null);
    void this.borrador.removeFoto(this.clave, 'dano');
  }

  next(): void {
    const s = this.step();
    if (s === 1 && !this.tipo()) {
      this.toast.error('Elige qué vas a reportar.');
      return;
    }
    if (this.esAccidente() && s === 2 && !this.fase()) {
      this.toast.error('Elige cuándo pasó.');
      return;
    }
    if (this.esAccidente() && s === 3 && !this.descripcion().trim()) {
      this.toast.error('Cuéntanos qué pasó.');
      return;
    }
    if (!this.esAccidente() && s === 3 && !this.danoFoto()) {
      this.toast.error('Toma una foto del daño.');
      return;
    }
    this.step.update((x) => Math.min(this.total(), x + 1));
  }

  prev(): void {
    if (this.step() === 1) {
      this.salir();
      return;
    }
    // Al volver al paso 1 se puede cambiar de tipo.
    if (this.step() === 2) {
      this.step.set(1);
      return;
    }
    this.step.update((x) => Math.max(1, x - 1));
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      if (this.esAccidente()) {
        await this.reportes.enqueueAccidente({
          vehiculoId: this.vehiculoId,
          fase: this.fase()!,
          descripcion: this.descripcion().trim(),
          lesionados: this.lesionados(),
          tercero: this.tercero().trim() || null,
          gps: this.gps,
          amet: this.amet() ? { blob: this.amet()!.blob, ext: this.amet()!.ext } : null,
        });
      } else {
        await this.reportes.enqueueDano({
          vehiculoId: this.vehiculoId,
          zona: this.zona(),
          descripcion: this.danoDescripcion().trim() || null,
          origen: this.danoOrigen(),
          foto: this.danoFoto()?.blob ?? null,
        });
      }
      await this.autosave.discard(this.clave); // limpia borrador + fotos
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return (
      !this.done() &&
      (!!this.tipo() ||
        !!this.descripcion().trim() ||
        this.lesionados() > 0 ||
        !!this.amet() ||
        !!this.danoFoto() ||
        !!this.danoDescripcion().trim())
    );
  }

  salir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
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
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
