import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { VehiculoCard } from '../../../shared/ui/vehiculo-card/vehiculo-card';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { TraspasoService, FallaChecklist } from '../../../core/services/traspaso.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { FOTOS_PREUSO } from '../../../core/models/checklist-preuso.model';

type Paso = 'vehiculo' | 'condiciones' | 'fotos' | 'llave' | 'firma';
type Respuesta = 'ok' | 'falla' | 'na';
type Llave1 = 'chofer_asignado' | 'oficina_central' | 'otro';

/** AI7 — "Uso de vehículo": checklist de 3 preguntas (Documentación, Llantas,
 *  Luces) + "Fotos y comentarios" (los foto-slots + comentario, ya en el flujo).
 *  Se quitó Frenos/Niveles/Carrocería; entra Documentación. Rápido de llenar. */
const CHECK_ITEMS = [
  'Documentación (matrícula y seguro)',
  'Llantas',
  'Luces',
] as const;

interface AsignarmeDraft {
  vehiculoId: string;
  km: number | null;
  checklist: Record<string, Respuesta>;
  /** AH13 — descripción escrita de cada falla (los blobs de voz/foto no se persisten). */
  fallaDesc?: Record<string, string>;
  llave1: Llave1 | null;
  llave1Detalle: string;
  notas: string;
}

/**
 * AF34 — "Asignarme vehículo" unificado con pre-uso. Elijo un vehículo (aunque esté
 * asignado a otro), documento sus condiciones (checklist corto + fotos + km) y firmo:
 * la responsabilidad pasa a mí y al anterior se le notifica. Ese acto ES el pre-uso.
 * Offline-first por outbox → `traspasar_vehiculo` (reasigna + acta + notifica + llave 1).
 */
@Component({
  selector: 'app-asignarme-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, WizardFooter, OptionButton, Skeleton, EmptyState, VehiculoCard, PhotoSlot, SignaturePad, VoiceNotes, KmInput],
  templateUrl: './asignarme.html',
  styleUrl: './asignarme.scss',
})
export class AsignarmeVehiculoPage {
  private vehiculos = inject(VehiculosService);
  private traspaso = inject(TraspasoService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  // AI6 — si llegamos aquí desde crear-ruta/conduce (vehículo no asignado), volvemos
  // a ese borrador al terminar el Uso de vehículo.
  private returnUrl: string | null = null;

  private sig = viewChild(SignaturePad);

  readonly pasos: Paso[] = ['vehiculo', 'condiciones', 'fotos', 'llave', 'firma'];
  readonly fotosGuiadas = FOTOS_PREUSO;
  readonly checkItems = CHECK_ITEMS;
  private readonly clave = 'transporte:asignarme';
  private hydrated = false;

  loading = signal(true);
  disponibles = signal<VehiculoDisponible[]>([]);
  asignadosAOtros = signal<Record<string, string>>({});
  fotoUrls = signal<Record<string, string>>({});
  seleccionado = signal<VehiculoDisponible | null>(null);
  odometro = signal<number | null>(null);

  step = signal(1);
  km = signal<number | null>(null);
  checklist = signal<Record<string, Respuesta>>({});
  // AH13 — evidencia por item con falla: descripción + notas de voz + fotos.
  fallaDesc = signal<Record<string, string>>({});
  fallaVoces = signal<Record<string, VoiceNoteItem[]>>({});
  fallaFotos = signal<Record<string, CapturedPhoto[]>>({});
  readonly maxFotosFalla = 3;
  fotos = signal<Record<string, CapturedPhoto>>({});
  llave1 = signal<Llave1 | null>(null);
  llave1Detalle = signal('');
  notas = signal('');
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  submitting = signal(false);
  done = signal(false);

  readonly total = this.pasos.length;
  readonly pasoActual = computed<Paso>(() => this.pasos[this.step() - 1] ?? 'vehiculo');

  /** Km debe ser >= odómetro registrado (regla no-retroceso). */
  kmMenorOdometro = computed(() => {
    const k = this.km();
    const o = this.odometro();
    return k != null && o != null && k < o;
  });

  /** Todas las fotos guiadas capturadas. */
  fotosCompletas = computed(() => this.fotosGuiadas.every((f) => !!this.fotos()[f.slot]));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [disp, activas] = await Promise.all([
        this.vehiculos.getVehiculosDisponibles(),
        this.vehiculos.getAsignacionesActivas().catch(() => ({})),
      ]);
      this.disponibles.set(disp);
      this.asignadosAOtros.set(activas as Record<string, string>);
      void this.resolveFotos(disp);
      await this.restoreDraft();
      // AI6 — preselección del vehículo + retorno al flujo de origen.
      const q = this.route.snapshot.queryParamMap;
      this.returnUrl = q.get('returnUrl');
      const preId = q.get('vehiculoId');
      if (preId && !this.seleccionado()) {
        const veh = disp.find((v) => v.vehiculo_id === preId);
        if (veh) {
          this.seleccionar(veh);
          this.step.set(2); // salta directo a condiciones
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async resolveFotos(disp: VehiculoDisponible[]): Promise<void> {
    await Promise.all(
      disp
        .filter((v) => v.foto_path)
        .map(async (v) => {
          const url = await this.vehiculos.getFotoUrl(v.foto_path);
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.vehiculo_id]: url }));
        }),
    );
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<AsignarmeDraft>(this.clave);
    if (d?.vehiculoId) {
      const veh = this.disponibles().find((v) => v.vehiculo_id === d.vehiculoId);
      if (veh) {
        this.seleccionado.set(veh);
        void this.cargarOdometro(veh.vehiculo_id);
        this.km.set(d.km ?? null);
        this.checklist.set(d.checklist ?? {});
        this.fallaDesc.set(d.fallaDesc ?? {});
        this.llave1.set(d.llave1 ?? null);
        this.llave1Detalle.set(d.llave1Detalle ?? '');
        this.notas.set(d.notas ?? '');
      }
    }
    this.hydrated = true;
    this.queueDraft();
  }

  queueDraft(): void {
    if (!this.hydrated || this.submitting() || this.done() || !this.seleccionado()) return;
    const snap: AsignarmeDraft = {
      vehiculoId: this.seleccionado()!.vehiculo_id,
      km: this.km(),
      checklist: this.checklist(),
      fallaDesc: this.fallaDesc(),
      llave1: this.llave1(),
      llave1Detalle: this.llave1Detalle(),
      notas: this.notas(),
    };
    this.autosave.queue(this.clave, snap, {
      tipo: 'asignarme',
      etiqueta: 'Uso de vehículo',
      ruta: this.location.path(),
    });
  }

  nombreAsignado(id: string): string {
    return this.asignadosAOtros()[id] ?? '';
  }

  seleccionar(v: VehiculoDisponible): void {
    // AF34 — se puede elegir aunque esté asignado a otro (traspaso).
    this.seleccionado.set(v);
    this.km.set(null);
    void this.cargarOdometro(v.vehiculo_id);
    this.queueDraft();
  }

  private async cargarOdometro(vehiculoId: string): Promise<void> {
    try {
      const d = await this.vehiculos.getVehiculoDetalle(vehiculoId);
      this.odometro.set(d?.kilometraje ?? null);
    } catch {
      this.odometro.set(null);
    }
  }

  setCheck(item: string, r: Respuesta): void {
    this.checklist.update((m) => ({ ...m, [item]: r }));
    this.queueDraft();
  }
  checkDe(item: string): Respuesta | null {
    return this.checklist()[item] ?? null;
  }

  // ─── AH13 — describir una falla con texto + voz + foto ──────────────────────
  esFalla(item: string): boolean {
    return this.checkDe(item) === 'falla';
  }
  descDe(item: string): string {
    return this.fallaDesc()[item] ?? '';
  }
  setDesc(item: string, v: string): void {
    this.fallaDesc.update((m) => ({ ...m, [item]: v }));
    this.queueDraft();
  }
  vocesDe(item: string): VoiceNoteItem[] {
    return this.fallaVoces()[item] ?? [];
  }
  setVoces(item: string, v: VoiceNoteItem[]): void {
    this.fallaVoces.update((m) => ({ ...m, [item]: v }));
  }
  fotosFallaDe(item: string): CapturedPhoto[] {
    return this.fallaFotos()[item] ?? [];
  }
  puedeAgregarFotoFalla(item: string): boolean {
    return this.fotosFallaDe(item).length < this.maxFotosFalla;
  }
  addFotoFalla(item: string, p: CapturedPhoto): void {
    this.fallaFotos.update((m) => ({ ...m, [item]: [...(m[item] ?? []), p] }));
  }
  quitarFotoFalla(item: string, idx: number): void {
    this.fallaFotos.update((m) => {
      const arr = [...(m[item] ?? [])];
      const f = arr[idx];
      if (f) URL.revokeObjectURL(f.previewUrl);
      arr.splice(idx, 1);
      return { ...m, [item]: arr };
    });
  }

  onFoto(slot: string, p: CapturedPhoto): void {
    this.fotos.update((m) => ({ ...m, [slot]: p }));
  }
  onFotoCleared(slot: string): void {
    this.fotos.update((m) => {
      const next = { ...m };
      const f = next[slot];
      if (f) URL.revokeObjectURL(f.previewUrl);
      delete next[slot];
      return next;
    });
  }

  async onFirmaChanged(has: boolean): Promise<void> {
    this.firmaLista.set(has);
    this.firmaBlob.set(has ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  private validarPaso(): boolean {
    switch (this.pasoActual()) {
      case 'vehiculo':
        if (!this.seleccionado()) {
          this.toast.error('Elige un vehículo.');
          return false;
        }
        return true;
      case 'condiciones':
        if (this.km() == null || this.km()! <= 0) {
          this.toast.error('Escribe el kilometraje actual.');
          return false;
        }
        if (this.kmMenorOdometro()) {
          this.toast.error(`El kilometraje no puede ser menor al registrado (${this.odometro()} km).`);
          return false;
        }
        if (this.checkItems.some((it) => !this.checkDe(it))) {
          this.toast.error('Responde todos los puntos del checklist.');
          return false;
        }
        return true;
      case 'fotos':
        if (!this.fotosCompletas()) {
          this.toast.error('Toma todas las fotos del vehículo.');
          return false;
        }
        return true;
      case 'llave':
        if (!this.llave1()) {
          this.toast.error('Indica dónde queda la llave 1.');
          return false;
        }
        if (this.llave1() === 'otro' && !this.llave1Detalle().trim()) {
          this.toast.error('Describe dónde queda la llave 1.');
          return false;
        }
        return true;
      case 'firma':
        return true;
    }
  }

  next(): void {
    if (!this.validarPaso()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }
  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  async confirmar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.firmaBlob()) {
      this.toast.error('Falta tu firma.');
      return;
    }
    const veh = this.seleccionado();
    if (!veh) return;
    this.submitting.set(true);
    try {
      const condiciones = {
        km: this.km(),
        items: this.checkItems.map((it) => ({ etiqueta: it, respuesta: this.checkDe(it) })),
      };
      const fotosBlobs: Record<string, Blob> = {};
      for (const [slot, ph] of Object.entries(this.fotos())) fotosBlobs[slot] = ph.blob;
      // AH13 — por cada item con falla: descripción + fotos + notas de voz → acta.
      const fallas: FallaChecklist[] = this.checkItems
        .filter((it) => this.checkDe(it) === 'falla')
        .map((it) => ({
          etiqueta: it,
          descripcion: this.descDe(it).trim() || null,
          fotos: this.fotosFallaDe(it).map((p) => p.blob),
          voces: this.vocesDe(it).map((n) => n.blob),
        }));
      await this.traspaso.enqueueTraspaso({
        vehiculoId: veh.vehiculo_id,
        km: this.km(),
        condiciones,
        fotos: fotosBlobs,
        firma: this.firmaBlob(),
        llave1Ubicacion: this.llave1(),
        llave1Detalle: this.llave1() === 'otro' ? this.llave1Detalle().trim() : null,
        notas: this.notas().trim() || null,
        fallas,
      });
      void this.autosave.discard(this.clave);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar el traspaso.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    // AI6 — si vinimos de crear-ruta/conduce, volvemos a ese borrador; si no, al hub.
    if (this.returnUrl) {
      void this.router.navigateByUrl(this.returnUrl, { replaceUrl: true });
      return;
    }
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  /** AF36 — ver el historial de recepciones/traspasos. */
  verHistorial(): void {
    void this.router.navigate(['/transporte/mis-actas']);
  }

  back(): void {
    if (this.step() > 1 && !this.done()) {
      this.prev();
      return;
    }
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
