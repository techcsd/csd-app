import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { DocQrService } from '../../../core/services/doc-qr.service';
import { TipoDocQr } from '../../../core/util/doc-qr';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * DX7/F4 — QR de un documento (mismo componente en conduce y requisición). No pinta nada si el
 * tipo está apagado en el servidor o el rol no puede verlo. El último QR emitido se guarda en el
 * teléfono: se puede MOSTRAR sin red (resolver sí requiere red).
 */
@Component({
  selector: 'app-doc-qr',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './doc-qr.html',
  styleUrl: './doc-qr.scss',
})
export class DocQr {
  private svc = inject(DocQrService);
  tipo = input.required<TipoDocQr>();
  id = input.required<string>();
  src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const t = this.tipo();
      const i = this.id();
      this.src.set(null);
      if (i) void this.svc.qrDataUrl(t, i).then((u) => this.src.set(u));
    });
  }
}
