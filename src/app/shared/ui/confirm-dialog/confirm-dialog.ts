import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Full-width yes/no confirmation for actions worth a second tap (sign out,
 * discard, etc.). Big targets, matches the field UI. Distinct from big-confirm,
 * which is a one-button success screen.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  open = input(false);
  title = input('¿Confirmar?');
  message = input('');
  confirmLabel = input('Sí');
  cancelLabel = input('Cancelar');
  /** 'danger' tints the confirm button red (sign out / destructive). */
  tone = input<'default' | 'danger'>('default');

  confirmed = output<void>();
  cancelled = output<void>();
}
