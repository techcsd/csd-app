import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { UbicacionDisclosureGate } from '../../../core/services/ubicacion-disclosure-gate.service';

/**
 * CI5 — Aviso previo (prominent disclosure) de ubicación en segundo plano. Hoja a
 * pantalla completa (no se puede saltar sin elegir). Vive en el shell y la controla
 * UbicacionDisclosureGate. El texto contiene "ubicación" y "también cuando la app
 * está cerrada o en segundo plano" (requisito literal de Google Play).
 */
@Component({
  selector: 'app-consentimiento-ubicacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './consentimiento-ubicacion.html',
  styleUrl: './consentimiento-ubicacion.scss',
})
export class ConsentimientoUbicacion {
  gate = inject(UbicacionDisclosureGate);
}
