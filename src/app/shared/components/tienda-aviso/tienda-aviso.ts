import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../../environments/environment';
import { TiendasService } from '../../../core/services/tiendas.service';
import { LocalStore } from '../../../core/services/local-store.service';
import { abrirUrlExterna } from '../../../core/utils/abrir-url.util';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * CI7 (F2.5) / CI9 (F6.8) — Aviso único, descartable, para migrar al canal oficial:
 *  · canal apk + play_store_url → "La CSD App ya está en Google Play…".
 *  · PWA iOS + app_store_url     → "La CSD App ya está en el App Store…".
 * No se muestra mientras la URL sea null. Se recuerda el descarte en LocalStore.
 */
@Component({
  selector: 'app-tienda-aviso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './tienda-aviso.html',
  styleUrl: './tienda-aviso.scss',
})
export class TiendaAviso {
  private tiendas = inject(TiendasService);
  private store = inject(LocalStore);

  private descartado = signal(false);

  private esIosPwa =
    !Capacitor.isNativePlatform() &&
    /iphone|ipad|ipod/i.test(navigator.userAgent || '');

  /** 'play' | 'appstore' | null — qué aviso corresponde a este canal. */
  tipo = computed<'play' | 'appstore' | null>(() => {
    if (this.descartado()) return null;
    if (environment.canal === 'apk' && this.tiendas.playUrl()) return 'play';
    if (environment.canal === 'pwa' && this.esIosPwa && this.tiendas.appStoreUrl()) return 'appstore';
    return null;
  });

  constructor() {
    void this.store.get('tienda_aviso_descartado').then((v) => {
      if (v === '1') this.descartado.set(true);
    });
  }

  abrir(): void {
    const url = this.tipo() === 'play' ? this.tiendas.playUrl() : this.tiendas.appStoreUrl();
    if (url) void abrirUrlExterna(url);
  }

  descartar(): void {
    this.descartado.set(true);
    void this.store.set('tienda_aviso_descartado', '1');
  }
}
