import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { OptionButton } from '../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { ReportesService, ReporteTipo } from '../../core/services/reportes.service';
import { CameraService, CapturedPhoto } from '../../core/services/camera.service';
import { NetworkService } from '../../core/services/network.service';
import { ToastService } from '../../core/services/toast.service';
import { GuardedWizard } from '../../shared/guarded-wizard';

/**
 * Reportar problema/mejora: any authenticated pilot user (driver/engineer) sends
 * feedback from the phone. Works offline via the outbox — queued and sent by
 * itself when signal returns. Dead-simple, glove-friendly single-screen form.
 */
@Component({
  selector: 'app-reportar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, BigConfirm, ConfirmDialog],
  templateUrl: './reportar.html',
  styleUrl: './reportar.scss',
})
export class ReportarPage extends GuardedWizard {
  private reportes = inject(ReportesService);
  private camera = inject(CameraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);

  constructor() {
    super();
    this.registerBackGuard();
  }

  readonly tipos = [
    { value: 'error' as ReporteTipo, label: 'Un problema / error', icon: '🐞' },
    { value: 'mejora' as ReporteTipo, label: 'Una mejora / sugerencia', icon: '💡' },
    { value: 'duda' as ReporteTipo, label: 'Una duda', icon: '❓' },
  ];

  tipo = signal<ReporteTipo>('error');
  asunto = signal('');
  descripcion = signal('');
  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);
  submitting = signal(false);
  done = signal(false);

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

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.asunto().trim()) {
      this.toast.error('Escribe un título corto.');
      return;
    }
    if (!this.descripcion().trim()) {
      this.toast.error('Cuéntanos qué pasó.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.reportes.enqueueReporte({
        tipo: this.tipo(),
        asunto: this.asunto(),
        descripcion: this.descripcion(),
        fotos: this.fotos().map((f) => f.blob),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** U4 — datos sin guardar (tras enviar ya no hay nada que perder). */
  tieneDatos(): boolean {
    return !this.done() && !!(this.asunto().trim() || this.descripcion().trim() || this.fotos().length);
  }

  finish(): void {
    void this.router.navigate(['/home'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
