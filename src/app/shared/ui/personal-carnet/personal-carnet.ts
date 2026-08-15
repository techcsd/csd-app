import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';
import { PersonalObra, NACIONALIDAD_LABEL } from '../../../core/models/personal-obra.model';

/**
 * AR1 (app) — Carnet del personal de obra: foto, nombre, cargo + ID del cargo,
 * obra, nacionalidad, número de carnet y QR que abre el expediente en la web SGC
 * (verificación). Mismo diseño que la web. El QR se genera offline desde el id.
 * Cuando el carnet aún no se ha emitido (registro sin sincronizar), muestra
 * "Se emitirá al sincronizar" — el número CSD-###### lo asigna el servidor.
 */
@Component({
  selector: 'app-personal-carnet',
  standalone: true,
  imports: [],
  templateUrl: './personal-carnet.html',
  styleUrl: './personal-carnet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalCarnet {
  personal = input.required<PersonalObra>();
  fotoDataUrl = input<string | null>(null);
  verifyUrl = input<string>('');

  readonly nacionalidadLabel = NACIONALIDAD_LABEL;

  qr = signal<string>('');

  constructor() {
    effect(() => {
      const url = this.verifyUrl();
      if (url) {
        void QRCode.toDataURL(url, { width: 240, margin: 1 }).then(
          (d) => this.qr.set(d),
          () => undefined,
        );
      }
    });
  }
}
