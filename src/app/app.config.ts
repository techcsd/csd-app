import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  isDevMode,
  inject,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { VehiculosService } from './core/services/vehiculos.service';
import { ConducesService } from './core/services/conduces.service';
import { BitacoraService } from './core/services/bitacora.service';
import { InventarioService } from './core/services/inventario.service';
import { SolicitudesService } from './core/services/solicitudes.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Instantiate feature services that register outbox handlers, so queued
    // captures sync even before the user opens that module.
    provideAppInitializer(() => {
      inject(VehiculosService);
      inject(ConducesService);
      inject(BitacoraService);
      inject(InventarioService);
      inject(SolicitudesService);
    }),
  ],
};
