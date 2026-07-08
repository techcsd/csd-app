import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { OptionButton } from '../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../shared/ui/big-confirm/big-confirm';
import { ReportesService, ReporteTipo } from '../../core/services/reportes.service';
import { NetworkService } from '../../core/services/network.service';
import { ToastService } from '../../core/services/toast.service';

/** Report an app problem / suggestion / comment to admin (SGC reportes). */
@Component({
  selector: 'app-reportar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, BigConfirm],
  templateUrl: './reportar.html',
  styleUrl: './reportar.scss',
})
export class ReportarPage {
  private reportes = inject(ReportesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  readonly tipos = [
    { value: 'bug' as ReporteTipo, label: 'Un problema / error', icon: '🐞' },
    { value: 'sugerencia' as ReporteTipo, label: 'Una sugerencia', icon: '💡' },
    { value: 'comentario' as ReporteTipo, label: 'Un comentario', icon: '💬' },
  ];

  tipo = signal<ReporteTipo>('bug');
  asunto = signal('');
  descripcion = signal('');
  submitting = signal(false);
  done = signal(false);

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
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para enviar tu reporte.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.reportes.crear(this.tipo(), this.asunto(), this.descripcion());
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/perfil'], { replaceUrl: true });
  }
}
