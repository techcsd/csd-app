import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  isDevMode,
  inject,
  Type,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling, withViewTransitions } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { ErrorReportService } from './core/services/error-report.service';
import { MotionService } from './core/services/motion.service';
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
import { CronogramaService } from './core/services/cronograma.service';
import { ObraService } from './core/services/obra.service';
import { TraspasoService } from './core/services/traspaso.service';
import { MensajesService } from './core/services/mensajes.service';
import { NotasService } from './core/services/notas.service';
import { RrhhService } from './core/services/rrhh.service';
import { TareasService } from './core/services/tareas.service';
import { TecnologiaService } from './core/services/tecnologia.service';
import { PersonalObraService } from './core/services/personal-obra.service';
import { SolicitudMovimientoService } from './core/services/solicitud-movimiento.service';
import { ApoyoService } from './core/services/apoyo.service';
import { TrabajosService } from './core/services/trabajos.service';
import { RetirosService } from './core/services/retiros.service';
import { CartillaService } from './core/services/cartilla.service';
import { SolicitudesCompraService } from './core/services/solicitudes-compra.service';
import { ReunionesService } from './core/services/reuniones.service';
import { PagosObraService } from './core/services/pagos-obra.service';
import { ClaudeModuloService } from './core/services/claude-modulo.service';
import { CatalogService } from './core/sync/catalog.service';
import { environment } from '../environments/environment';

// DU2c — servicios que fallaron al instanciarse en el arranque (se reportan al final).
const fallosArranque: string[] = [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Y6 — telemetría de errores: el ErrorHandler global usa el mismo singleton
    // que se instancia abajo (para que report() y el handler del outbox compartan
    // estado). Los listeners de window/promesa ya los instala provideBrowser… →
    // desembocan aquí. `useExisting` evita crear dos instancias.
    { provide: ErrorHandler, useExisting: ErrorReportService },
    // P9 — toda pantalla abre arriba (y respeta anclas). Además, en app.ts se
    // resetea el scroll de los contenedores internos (.screen/.screen__body),
    // que Angular no restaura por sí solo.
    // CJ1 — crossfade entre pantallas (View Transitions API). skipInitialTransition:
    // no anima el primer render. Navegadores sin soporte: sin animación (nada se
    // rompe). El estilo del crossfade vive en styles.scss (::view-transition-*).
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      withViewTransitions({ skipInitialTransition: true }),
    ),
    // CO10/CO17 — se registra `push-sw.js` (no `ngsw-worker.js` directo): es una capa
    // fina que hace `importScripts('./ngsw-worker.js')` + pinta ella misma la
    // notificación cuando el push llega en el formato plano `{title,body,url}` que
    // manda el edge del padre (ngsw-worker.js solo entiende `{notification:{...}}}`
    // y si no, no hace nada). Angular sigue gestionando caché/versión normalmente;
    // `provideServiceWorker` no exige que el archivo se llame `ngsw-worker.js`.
    provideServiceWorker('push-sw.js', {
      // DU — en la app NATIVA (APK/IPA) el service worker sobra: los archivos ya viajan dentro del paquete y
      // el push es nativo. Allí su instalación fallaba siempre en `/favicon.ico` (WebView) y cada fallo
      // disparaba «Reparando la app…» + PIN de nuevo tras actualizar. Solo la PWA lo usa.
      enabled: !isDevMode() && !Capacitor.isNativePlatform(),
      // CO1 — con `registerWhenStable:30000` un chofer que abre y cierra la PWA
      // antes de los 30s nunca llega a registrar el SW ese día (y con el sistema de
      // movimiento de CJ, "estable" tarda más). `registerImmediately` registra el SW
      // en cuanto arranca la app, sin esperar.
      registrationStrategy: 'registerImmediately',
    }),
    // Instantiate feature services that register outbox handlers, so queued
    // captures sync even before the user opens that module.
    provideAppInitializer(() => {
      // DU2c — cada servicio de arranque va aislado: uno roto se reporta y NO tumba la app
      // (antes cualquier excepción síncrona aquí = pantalla en blanco sin mensaje).
      // DU — instalaciones nativas anteriores ya tienen el service worker registrado: se quita (best-effort).
      if (Capacitor.isNativePlatform() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((rs) => Promise.all(rs.map((r) => r.unregister())))
          .catch(() => undefined);
      }
      const boot = (token: Type<unknown>): void => {
        try {
          inject(token);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[boot]', token.name, e);
          try {
            fallosArranque.push(`${token.name}: ${(e as Error)?.message ?? e}`);
          } catch {
            /* best-effort */
          }
        }
      };
      // Y6 — instanciar primero la telemetría: registra su handler de outbox y
      // engancha el sink de fallos permanentes del SyncService desde el arranque.
      boot(ErrorReportService);
      // CJ1 — aplica la clase `motion-reduced` en <html> desde el arranque según el
      // ajuste del usuario (antes del primer crossfade).
      boot(MotionService);
      boot(VehiculosService);
      boot(MantenimientosService);
      boot(ChecklistPreusoService);
      boot(ReporteSemanalService);
      boot(ConducesService);
      // S30 — faltaba: sin bootearlo, el handler 'combustible' no se registraba y
      // las echadas quedaban "En cola" para siempre (el caso real atascado 23h).
      boot(CombustibleService);
      boot(BitacoraService);
      boot(InventarioService);
      boot(SolicitudesService);
      boot(ReportesService);
      boot(ClLiberacionService);
      // Q3-fix — sin esto, el handler 'documento_upload' no se registraba al
      // arrancar y las subidas de cédula/licencia quedaban "En cola" para siempre
      // (el drain las saltaba por falta de handler). Booteando el servicio aquí,
      // su handler queda registrado y esos envíos se procesan.
      boot(DocumentosService);
      // S22/S24 — handlers de accidente/daño/multa registrados al boot.
      boot(FlotaReportesService);
      // Y15 — handlers de cronograma (cronograma_tarea_iniciar/completar/enlazar +
      // compat de las claves viejas tarea_iniciar/completar). Ver QA-1.
      boot(CronogramaService);
      // AG16 — handlers de Gestión de Obra (charla/NC/incidente/checklist/…).
      boot(ObraService);
      // QA-4 (AJ15) — S30-class: estos 5 servicios registran handlers de outbox en
      // su constructor pero no se instanciaban al arranque → capturas offline
      // (traspaso/mensaje/nota/asignación RRHH/tarea) quedaban "En cola" para siempre
      // tras un reinicio en frío si la señal volvía antes de abrir el módulo.
      boot(TraspasoService); // vehiculo_traspaso
      boot(MensajesService); // mensaje_enviar
      boot(NotasService); // nota_guardar / nota_checklist_set
      boot(RrhhService); // rrhh_asignar_item / rrhh_asignacion_estado
      boot(TareasService); // tarea_app_iniciar / tarea_app_completar
      boot(TecnologiaService); // AL2 — tec_equipo_guardar
      boot(PersonalObraService); // AR1 — personal_registro / personal_editar
      boot(SolicitudMovimientoService); // AY11 — solicitud_movimiento_crear (offline)
      boot(ApoyoService); // CK12/CK13 — apoyo_crear + apoyo_estado (offline, idempotente)
      boot(TrabajosService); // CK14 — trabajo_evento (chofer reporta avance, offline+foto)
      boot(RetirosService); // BG4 — retiro_material (retiro de material dañado, offline)
      boot(CartillaService); // BO10 — cartilla (cartillas de acero, offline)
      boot(SolicitudesCompraService); // BH8 — solicitud_compra_crear (offline, idempotente)
      boot(ReunionesService); // CP8 — reunion_nota (offline, outbox con foto de pizarra)
      // A4 — S30-class: sin bootearlo, el handler 'pagos_firma' no se registra y
      // las firmas/monto-concepto de "Pagos" quedarían "En cola" para siempre.
      boot(PagosObraService);
      // DM1 — S30-class: sin bootearlo, 'claude_encuesta'/'claude_skill_crear'
      // no se registran y quedarían "En cola" para siempre si se crean sin red.
      boot(ClaudeModuloService);

      // BJ5 — al estrenar versión, suelta las cachés de proyectos que pudieron
      // guardar un VACÍO bajo la RLS vieja (lista/pickers/liberación/conduces). El
      // prefijo 'proyectos' cubre 'proyectos', 'proyectos_full' y 'proyectos_pickables'.
      // DA-19 — 'tec_equipo' cubre 'tec_equipos'/'tec_equipo_tipos'/
      // 'tec_equipo_estados'/'tec_equipo_condiciones': la ronda DA agregó
      // columnas/specs al `select('*')` de equipos — sin este bust, un caché
      // offline previo a esta versión seguiría sin ellas hasta su TTL natural.
      // Idempotente por versión; nunca rompe el arranque.
      try {
        void inject(CatalogService).invalidateOnVersionChange(environment.version, ['proyectos', 'tec_equipo']);
      } catch (e) {
        fallosArranque.push(`CatalogService: ${(e as Error)?.message ?? e}`);
      }

      // DU2e — reporta (sin datos personales) lo que falló al arrancar: servicios que
      // no se pudieron instanciar y/o el último "No pudimos abrir la app" que mostró el
      // guard de index.html (guardado en localStorage por no haber red/app en ese momento).
      try {
        let previo: { motivo?: string; ua?: string } | null = null;
        try {
          const raw = localStorage.getItem('csd-boot-fail');
          if (raw) {
            previo = JSON.parse(raw) as { motivo?: string; ua?: string };
            localStorage.removeItem('csd-boot-fail');
          }
        } catch {
          /* best-effort */
        }
        if (fallosArranque.length || previo) {
          const er = inject(ErrorReportService);
          if (fallosArranque.length) void er.report('crash', `arranque: servicios fallidos — ${fallosArranque.join(' | ')}`, {});
          if (previo) void er.report('crash', `arranque: pantalla de rescate — ${previo.motivo ?? 'sin motivo'}`, { ua: previo.ua ?? null });
        }
      } catch {
        /* best-effort */
      }
    }),
  ],
};
