import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ConducesService } from '../../core/services/conduces.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * DS-49 / #58 / #74 — destino del QR del conduce. Valida el token (firma + vencimiento, edge
 * `conduce-qr` de SGC) y abre la recepción de ESA salida en "Entregas por recibir". Los permisos
 * (receptor asignado, responsable, capataz, chofer) siguen decididos por el servidor: la edge solo
 * identifica el conduce y la bandeja/RPC de recepción validan quién puede cerrarlo.
 * Sin sesión → los guards recuerdan este enlace y lo retoman tras login + PIN.
 */
@Component({
  selector: 'app-conduce-qr',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './conduce-qr.html',
  styleUrl: './conduce-qr.scss',
})
export class ConduceQrPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private conduces = inject(ConducesService);
  private i18n = inject(I18nService);

  error = signal('');

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const r = await this.conduces.resolverQrConduce(token);
      await this.router.navigate(['/transporte/por-confirmar'], { queryParams: { abrir: r.salidaId }, replaceUrl: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      this.error.set(
        m === 'qr_desactivado'
          ? this.i18n.t('El QR del conduce aún no está disponible. Abre el conduce desde tu bandeja.')
          : m === 'sin_red'
            ? this.i18n.t('Necesitas conexión para abrir este QR.')
            : this.i18n.t('Este QR no es válido o ya venció. Pide al almacén que te comparta el conduce de nuevo.'),
      );
    }
  }
}
