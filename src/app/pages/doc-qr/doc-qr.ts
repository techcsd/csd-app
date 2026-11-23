import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { DocQrService } from '../../core/services/doc-qr.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { mensajeErrorQr, rutaAppDeDoc } from '../../core/util/doc-qr';

/**
 * DX7/F4 — destino único `/d/:token` del QR de cualquier documento. Resuelve el token (edge
 * `conduce-qr`, online-only) y lleva a la pantalla correcta según el TIPO; el rol lo decide la
 * propia pantalla/RLS (el QR no otorga permisos y nunca muestra datos aquí). Sin sesión, los guards
 * recuerdan el enlace y lo retoman tras login + PIN.
 */
@Component({
  selector: 'app-doc-qr',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './doc-qr.html',
  styleUrl: './doc-qr.scss',
})
export class DocQrPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private docQr = inject(DocQrService);
  private i18n = inject(I18nService);

  error = signal('');

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const r = await this.docQr.resolver(token);
      const dest = rutaAppDeDoc(r.tipo, r.id);
      if (!dest) throw new Error('sin_pantalla');
      await this.router.navigate([dest.ruta], { queryParams: dest.query, replaceUrl: true });
    } catch (e) {
      const codigo = e instanceof Error ? e.message : '';
      this.error.set(this.i18n.t(mensajeErrorQr(codigo)));
    }
  }
}
