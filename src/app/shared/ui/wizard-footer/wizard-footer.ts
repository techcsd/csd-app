import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * B5 — shared sticky footer for wizards / HOJAS. One place for the safe-area +
 * keyboard-aware sticky bar with an optional back button and a primary CTA, so
 * the pattern isn't copy-pasted per page. The primary button never shrinks (the
 * CTA is always visible — footer-btn-width gotcha handled here).
 */
@Component({
  selector: 'app-wizard-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wizard-footer.html',
  styleUrl: './wizard-footer.scss',
})
export class WizardFooter {
  /** Back button label; empty hides the back button. */
  backLabel = input('');
  backDisabled = input(false);
  primaryLabel = input.required<string>();
  primaryDisabled = input(false);

  back = output<void>();
  primary = output<void>();
}
