import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
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
  imports: [FormsModule, StepBar, PhotoSlot, OptionButton, SignaturePad, BigConfirm],
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
  km = signal<number | null>(null);
  combustible = signal<CombustibleNivel | null>(null);
  tieneDanos = signal<boolean | null>(null);
  danos = signal<DanoDraft[]>([]);
  firmaLista = signal(false);
  private gps: { lat: number; lng: number } | null = null;

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
    const v = await this.vehiculos.getVehiculo(this.vehiculoId);
    if (v) {
      this.placa.set(v.placa);
      this.modelo.set(`${v.marca} ${v.modelo}`);
    }
  }

  private async captureGps(): Promise<void> {
    try {
      const pos = await Geolocation.getCurrentPosition({ timeout: 8000 });
      this.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      this.gps = null; // GPS is best-effort (VEH-06).
    }
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

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const firmaBlob = await this.sig()?.toBlob();
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
