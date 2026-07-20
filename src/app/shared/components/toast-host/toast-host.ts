import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, Toast } from '../../../core/services/toast.service';

/** Renders transient toasts at the top of the screen. */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.scss',
})
export class ToastHost {
  private toastService = inject(ToastService);
  toasts = this.toastService.toasts;

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }

  runAction(t: Toast): void {
    t.action?.run();
    this.toastService.dismiss(t.id);
  }
}
