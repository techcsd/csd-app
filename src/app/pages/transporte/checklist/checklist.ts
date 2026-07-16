import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CombustibleNivel,
  EntregaTipo,
  FOTOS_REQUERIDAS,
  NIVELES_COMBUSTIBLE,
  ZONAS_DANO,
} from '../../../core/models/transporte.model';

interface DanoDraft {
  zona: string;
  descripcion: string;
  photo: CapturedPhoto | null;
}

const TOTAL_STEPS = 6;

/**
 * The vehicle responsibility checklist (recepción / devolución). One question
 * per screen, photo-first, huge targets. Nothing can be confirmed without the
 * 6 guided photos + a signature. Saved offline via the outbox.
 */
@Component({
  selector: 'app-checklist',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, SignaturePad, BigConfirm, Skeleton],
  templateUrl: './checklist.html',
  styleUrl: './checklist.scss',
})
export class ChecklistPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL_STEPS;
  readonly fotosReq = FOTOS_REQUERIDAS;
  readonly niveles = NIVELES_COMBUSTIBLE;
  readonly zonas = ZONAS_DANO;

  tipo: EntregaTipo = 'recepcion';
  vehiculoId = '';
  placa = signal('');
  modelo = signal('');

  step = signal(1);
  fotos = signal<Record<string, CapturedPhoto>>({});
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo
  km = signal<number | null>(null);
  odometro = signal<number | null>(null);
  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });
  combustible = signal<CombustibleNivel | null>(null);
  tieneDanos = signal<boolean | null>(null);
  danos = signal<DanoDraft[]>([]);
  firmaLista = signal(false);
  // Capturamos la firma al dibujarla; el pad vive en un paso anterior al de envío.
  firmaBlob = signal<Blob | null>(null);
  private gps: { lat: number; lng: number } | null = null;
  /** X2 — estado de la captura de GPS para avisar al usuario (no bloquea). */
  gpsEstado = signal<'capturando' | 'ok' | 'sin-ubicacion'>('capturando');

  submitting = signal(false);
  done = signal(false);

  titulo = computed(() => (this.tipo === 'recepcion' ? 'Recibir vehículo' : 'Devolver vehículo'));

  fotosCompletas = computed(() =>
    this.fotosReq.every((f) => !!this.fotos()[f.slot]),
  );

  constructor() {
    this.tipo = (this.route.snapshot.data['tipo'] as EntregaTipo) ?? 'recepcion';
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.loadVehiculo();
    void this.captureGps();
  }

  private async loadVehiculo(): Promise<void> {
    try {
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
        this.odometro.set(v.kilometraje ?? null); // APP-011 — base de coherencia de km
      }
    } finally {
      this.loading.set(false); // APP-038
    }
  }

  private async captureGps(): Promise<void> {
    this.gpsEstado.set('capturando');
    try {
      const pos = await Geolocation.getCurrentPosition({ timeout: 8000 });
      this.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.gpsEstado.set('ok');
    } catch {
      // GPS is best-effort (VEH-06 / X2): sin permiso o sin señal, se registra
      // igual "sin ubicación" — nunca bloquea el flujo. Avisamos en el resumen.
      this.gps = null;
      this.gpsEstado.set('sin-ubicacion');
    }
  }

  /** X2 — permite reintentar la ubicación desde el resumen (permiso/señal). */
  reintentarGps(): void {
    void this.captureGps();
  }

  onFoto(slot: string, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [slot]: photo }));
  }

  onFotoCleared(slot: string): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[slot];
      return next;
    });
  }

  setDanos(value: boolean): void {
    this.tieneDanos.set(value);
    if (value && this.danos().length === 0) this.addDano();
    if (!value) this.danos.set([]);
  }

  addDano(): void {
    this.danos.update((d) => [...d, { zona: 'frente', descripcion: '', photo: null }]);
  }

  setDanoZona(i: number, zona: string): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, zona } : x)));
  }

  setDanoDesc(i: number, descripcion: string): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, descripcion } : x)));
  }

  onDanoFoto(i: number, photo: CapturedPhoto): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, photo } : x)));
  }

  removeDano(i: number): void {
    this.danos.update((d) => d.filter((_, idx) => idx !== i));
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Per-step gate so the user can't skip required evidence. */
  canAdvance(): boolean {
    switch (this.step()) {
      case 2:
        if (!this.fotosCompletas()) {
          this.toast.error('Faltan fotos. Toma las 6 fotos del vehículo.');
          return false;
        }
        return true;
      case 3:
        if (this.km() === null || this.km()! < 0) {
          this.toast.error('Escribe el kilometraje.');
          return false;
        }
        if (this.kmInvalido()) {
          this.toast.error(`El kilometraje no puede ser menor al último registrado (${this.odometro()} km).`);
          return false;
        }
        if (!this.combustible()) {
          this.toast.error('Elige el nivel de combustible.');
          return false;
        }
        return true;
      case 4:
        if (this.tieneDanos() === null) {
          this.toast.error('Dinos si viste algún daño.');
          return false;
        }
        if (this.tieneDanos() && this.danos().some((d) => !d.photo)) {
          this.toast.error('Toma la foto de cada daño.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  /** Store the signature blob while the pad is still mounted (its step is live). */
  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    this.firmaBlob.set(hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const firmaBlob = this.firmaBlob();
    if (!firmaBlob) {
      this.toast.error('Falta la firma.');
      return;
    }
    this.submitting.set(true);
    try {
      const fotos: Record<string, Blob> = {};
      for (const f of this.fotosReq) fotos[f.slot] = this.fotos()[f.slot].blob;

      await this.vehiculos.enqueueEntrega({
        vehiculoId: this.vehiculoId,
        tipo: this.tipo,
        km: this.km()!,
        combustible: this.combustible()!,
        observacion: null,
        gps: this.gps,
        fotos,
        firma: firmaBlob,
        danos: this.danos().map((d) => ({
          zona: d.zona,
          descripcion: d.descripcion,
          blob: d.photo!.blob,
        })),
        placa: this.placa(),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
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
