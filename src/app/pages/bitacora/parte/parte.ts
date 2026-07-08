import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BorradorService } from '../../../core/services/borrador.service';

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
  private borrador = inject(BorradorService);

  private readonly DRAFT = 'parte_diario';
  private hydrated = false;

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
  selEstructuras = signal<string[]>([]);
  selActividades = signal<string[]>([]);

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
    // Autosave the (non-photo) draft on every change so a killed app recovers.
    effect(() => {
      const snap = {
        proyectoId: this.proyectoId(),
        carpinteria: this.carpinteria(),
        acero: this.acero(),
        casa: this.casa(),
        otroPersonal: this.otroPersonal(),
        actividades: this.actividades(),
        restricciones: this.restricciones(),
        comentarios: this.comentarios(),
        step: this.step(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.hasContent(snap)) return;
      void this.borrador.save(this.DRAFT, snap);
    });
  }

  private hasContent(s: {
    step: number;
    carpinteria: number;
    acero: number;
    casa: number;
    otroPersonal: string;
    actividades: ActividadEntry[];
    restricciones: string[];
    comentarios: string;
  }): boolean {
    return (
      s.step > 1 ||
      s.carpinteria > 0 ||
      s.acero > 0 ||
      s.casa > 0 ||
      !!s.otroPersonal ||
      s.actividades.length > 0 ||
      s.restricciones.length > 0 ||
      !!s.comentarios
    );
  }

  private async load(): Promise<void> {
    const list = await this.bitacora.getProyectos();
    this.proyectos.set(list);

    const draft = await this.borrador.load<{
      proyectoId: string;
      carpinteria: number;
      acero: number;
      casa: number;
      otroPersonal: string;
      actividades: ActividadEntry[];
      restricciones: string[];
      comentarios: string;
      step: number;
    }>(this.DRAFT);

    if (draft) {
      this.proyectoId.set(draft.proyectoId);
      this.carpinteria.set(draft.carpinteria);
      this.acero.set(draft.acero);
      this.casa.set(draft.casa);
      this.otroPersonal.set(draft.otroPersonal);
      this.actividades.set(draft.actividades ?? []);
      this.restricciones.set(draft.restricciones ?? []);
      this.comentarios.set(draft.comentarios ?? '');
      this.step.set(draft.step ?? 1);
      this.toast.show('Recuperamos tu bitácora a medio llenar. Las fotos hay que tomarlas de nuevo.', 'info', 4500);
    } else {
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (list.length === 1) this.proyectoId.set(list[0].id);
    }
    this.hydrated = true;
  }

  toggleEstructura(e: string): void {
    this.selEstructuras.update((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]));
  }

  toggleActividad(a: string): void {
    this.selActividades.update((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  }

  /** Adds every selected estructura × actividad combination (deduped). */
  addActividad(): void {
    if (!this.selEstructuras().length || !this.selActividades().length) {
      this.toast.error('Elige al menos una estructura y una actividad.');
      return;
    }
    this.actividades.update((current) => {
      const next = [...current];
      for (const est of this.selEstructuras()) {
        for (const act of this.selActividades()) {
          if (!next.some((x) => x.estructura === est && x.actividad === act)) {
            next.push({ estructura: est, actividad: act });
          }
        }
      }
      return next;
    });
    this.selEstructuras.set([]);
    this.selActividades.set([]);
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
      this.hydrated = false; // stop autosave; discard the draft
      await this.borrador.clear(this.DRAFT);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }
}
