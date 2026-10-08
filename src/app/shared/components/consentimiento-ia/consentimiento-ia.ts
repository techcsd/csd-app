import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BottomSheet } from '../../ui/bottom-sheet/bottom-sheet';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { IaConsentGate } from '../../../core/services/ia-consent-gate.service';

/**
 * CI10 — Hoja de consentimiento para el asistente con IA (Compa, transcripción de
 * notas de voz, lectura de recibos). Vive en el shell (app.html) y la controla
 * IaConsentGate. Nombra a los terceros (Anthropic, Groq/OpenAI), dice qué se envía
 * y que no se usa para publicidad. "Ahora no" no rompe nada: la función no se usa.
 */
@Component({
  selector: 'app-consentimiento-ia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, TranslatePipe],
  templateUrl: './consentimiento-ia.html',
  styleUrl: './consentimiento-ia.scss',
})
export class ConsentimientoIa {
  gate = inject(IaConsentGate);
}
