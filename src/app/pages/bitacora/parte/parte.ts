import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { Counter } from '../../../shared/ui/counter/counter';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  ACTIVIDADES,
  ActividadEntry,
  ESTRUCTURAS,
  Proyecto,
  RESTRICCIONES,
} from '../../../core/models/bitacora.model';

const TOTAL = 6;

/** Parte diario wizard — one section per screen, photo-first (User Flow §4). */
@Component({
  selector: 'app-parte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, Counter, OptionButton, BigConfirm],
  templateUrl: './parte.html',
  styleUrl: './parte.scss',
})
export class PartePage {
  private router = inject(Router);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);

  readonly total = TOTAL;
  readonly estructuras = ESTRUCTURAS;
  readonly actividadesCat = ACTIVIDADES;
  readonly restriccionesCat = RESTRICCIONES;

  step = signal(1);
  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');

  carpinteria = signal(0);
  acero = signal(0);
  casa = signal(0);
  otroPersonal = signal('');

  actividades = signal<ActividadEntry[]>([]);
  nuevaEstructura = signal<string>('');
  nuevaActividad = signal<string>('');

  restricciones = signal<string[]>([]);
  comentarios = signal('');

  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);

  submitting = signal(false);
  done = signal(false);

  proyectoNombre = computed(
    () => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '',
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const list = await this.bitacora.getProyectos();
    this.proyectos.set(list);
    const obra = this.ctx.obraActiva();
    if (obra) this.proyectoId.set(obra.id);
    else if (list.length === 1) this.proyectoId.set(list[0].id);
  }

  addActividad(): void {
    if (!this.nuevaEstructura() || !this.nuevaActividad()) {
      this.toast.error('Elige estructura y actividad.');
      return;
    }
    this.actividades.update((a) => [
      ...a,
      { estructura: this.nuevaEstructura(), actividad: this.nuevaActividad() },
    ]);
    this.nuevaEstructura.set('');
    this.nuevaActividad.set('');
  }

  removeActividad(i: number): void {
    this.actividades.update((a) => a.filter((_, idx) => idx !== i));
  }

  toggleRestriccion(r: string): void {
    this.restricciones.update((list) =>
      list.includes(r) ? list.filter((x) => x !== r) : [...list, r],
    );
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

  removeFoto(i: number): void {
    const f = this.fotos()[i];
    if (f) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((list) => list.filter((_, idx) => idx !== i));
  }

  next(): void {
    if (this.step() === 1 && !this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.bitacora.enqueueParteDiario({
        proyectoId: this.proyectoId(),
        personalCarpinteria: this.carpinteria(),
        personalAcero: this.acero(),
        trabajadoresCasa: this.casa(),
        otroPersonal: this.otroPersonal().trim() || null,
        actividades: this.actividades(),
        restricciones: this.restricciones().length ? this.restricciones() : ['NINGUNA'],
        comentarios: this.comentarios().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/bitacora']);
  }
}
