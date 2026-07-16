import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

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
import {
  INCIDENTE_GRAVEDADES,
  INCIDENTE_TIPOS,
  Proyecto,
} from '../../../core/models/bitacora.model';

/** Short emergency flow: tipo → gravedad → ¿heridos? → fotos → nota (User Flow §5). */
@Component({
  selector: 'app-incidente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, Counter, BigConfirm, ConfirmDialog, VoiceRecorder, Skeleton],
  templateUrl: './incidente.html',
  styleUrl: './incidente.scss',
})
export class IncidentePage implements OnDestroy {
  private router = inject(Router);
  private location = inject(Location);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);

  readonly tipos = INCIDENTE_TIPOS;
  readonly gravedades = INCIDENTE_GRAVEDADES;

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  proyectoId = signal('');
  tipo = signal<'incidente' | 'accidente' | null>(null);
  gravedad = signal<string>('');
  lesionados = signal(0);
  descripcion = signal('');
  // W3 — acciones/medidas tomadas + subcontratista (paridad con la web).
  acciones = signal('');
  subcontratista = signal('');
  voz = signal<Blob | null>(null);
  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  hayHeridos = computed(() => this.lesionados() > 0);

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.load();
    this.navGuard.register(this.backHandler); // APP-036 — botón físico Android
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.bitacora.getProyectos();
      this.proyectos.set(list);
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (list.length === 1) this.proyectoId.set(list[0].id);
    } finally {
      this.loading.set(false);
    }
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

  /** APP-060 — agregar fotos de evidencia previa desde la galería. */
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

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    if (!this.tipo()) {
      this.toast.error('Elige si es incidente o accidente.');
      return;
    }
    if (!this.gravedad()) {
      this.toast.error('Elige la gravedad.');
      return;
    }
    if (!this.descripcion().trim()) {
      this.toast.error('Describe qué pasó. Sin descripción no se puede resolver.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.bitacora.enqueueIncidente({
        proyectoId: this.proyectoId(),
        tipo: this.tipo()!,
        gravedad: this.gravedad(),
        lesionados: this.lesionados(),
        descripcion: this.descripcion().trim() || null,
        acciones: this.acciones().trim() || null,
        subcontratista: this.subcontratista().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
        voz: this.voz(),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  /** APP-036 — ¿hay algo capturado que se perdería al salir? */
  private tieneDatos(): boolean {
    return (
      !this.done() &&
      (!!this.tipo() ||
        !!this.gravedad() ||
        this.lesionados() > 0 ||
        !!this.descripcion().trim() ||
        !!this.acciones().trim() ||
        !!this.subcontratista().trim() ||
        this.fotos().length > 0 ||
        !!this.voz())
    );
  }

  back(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.location.back();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.location.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  finish(): void {
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }
}
