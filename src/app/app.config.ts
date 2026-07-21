import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  isDevMode,
  inject,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { VehiculosService } from './core/services/vehiculos.service';
import { MantenimientosService } from './core/services/mantenimientos.service';
import { ChecklistPreusoService } from './core/services/checklist-preuso.service';
import { ReporteSemanalService } from './core/services/reporte-semanal.service';
import { ConducesService } from './core/services/conduces.service';
import { CombustibleService } from './core/services/combustible.service';
import { BitacoraService } from './core/services/bitacora.service';
import { InventarioService } from './core/services/inventario.service';
import { SolicitudesService } from './core/services/solicitudes.service';
import { ReportesService } from './core/services/reportes.service';
import { ClLiberacionService } from './core/services/cl-liberacion.service';
import { DocumentosService } from './core/services/documentos.service';
import { FlotaReportesService } from './core/services/flota-reportes.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // P9 — toda pantalla abre arriba (y respeta anclas). Además, en app.ts se
    // resetea el scroll de los contenedores internos (.screen/.screen__body),
    // que Angular no restaura por sí solo.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Instantiate feature services that register outbox handlers, so queued
    // captures sync even before the user opens that module.
    provideAppInitializer(() => {
      inject(VehiculosService);
      inject(MantenimientosService);
      inject(ChecklistPreusoService);
      inject(ReporteSemanalService);
      inject(ConducesService);
      // S30 — faltaba: sin bootearlo, el handler 'combustible' no se registraba y
      // las echadas quedaban "En cola" para siempre (el caso real atascado 23h).
      inject(CombustibleService);
      inject(BitacoraService);
      inject(InventarioService);
      inject(SolicitudesService);
      inject(ReportesService);
      inject(ClLiberacionService);
      // Q3-fix — sin esto, el handler 'documento_upload' no se registraba al
      // arrancar y las subidas de cédula/licencia quedaban "En cola" para siempre
      // (el drain las saltaba por falta de handler). Booteando el servicio aquí,
      // su handler queda registrado y esos envíos se procesan.
      inject(DocumentosService);
      // S22/S24 — handlers de accidente/daño/multa registrados al boot.
      inject(FlotaReportesService);
    }),
  ],
};
