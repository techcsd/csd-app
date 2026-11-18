import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { BottomSheet } from '../../ui/bottom-sheet/bottom-sheet';
import { GpsAsistenteService } from '../../../core/services/gps-asistente.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { TrackingService } from '../../../core/services/tracking.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * DS-51 F4.1 — asistente corto para encender el GPS: explica el paso según el motivo (permiso
 * negado vs ubicación del teléfono apagada), abre los ajustes, reintenta y, si el chofer decide
 * no activarlo, guarda el motivo (sin datos personales) para el reporte de adopción.
 */
@Component({
  selector: 'app-gps-asistente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, TranslatePipe],
  templateUrl: './gps-asistente.html',
  styleUrl: './gps-asistente.scss',
})
export class GpsAsistente {
  asistente = inject(GpsAsistenteService);
  private tracking = inject(TrackingService);
  private permissions = inject(PermissionsService);
  private i18n = inject(I18nService);

  comprobando = signal(false);
  sigueApagado = signal(false);
  eligiendoMotivo = signal(false);

  abrirAjustes(): void {
    void this.permissions.openAppSettings();
  }

  async yaLoActive(): Promise<void> {
    if (this.comprobando()) return;
    this.comprobando.set(true);
    this.sigueApagado.set(false);
    try {
      const ok = await this.tracking.revisarGps();
      // Encendida pero sin señal tampoco bloquea: la acción sigue y queda registrada como «sin_senal».
      if (ok || this.tracking.gpsUltimaRazon() === 'timeout') this.cerrar(true);
      else this.sigueApagado.set(true);
    } finally {
      this.comprobando.set(false);
    }
  }

  /** Cierra sin activar: pregunta el motivo (3 opciones fijas) y lo registra. */
  ahoraNo(): void {
    this.eligiendoMotivo.set(true);
  }

  elegirMotivo(clave: 'no_quiero_compartir' | 'no_se_como' | 'ahora_no'): void {
    this.tracking.registrarRechazoAsistente(clave, this.asistente.motivo());
    this.cerrar(false);
  }

  private cerrar(ok: boolean): void {
    this.eligiendoMotivo.set(false);
    this.sigueApagado.set(false);
    this.asistente.cerrar(ok);
  }

  titulo(): string {
    return this.i18n.t('Enciende tu ubicación');
  }
}
