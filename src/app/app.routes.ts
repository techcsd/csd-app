import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { pinGuard } from './core/guards/pin.guard';
import { moduleGuard, moduleAnyGuard, roleAnyGuard, submoduleGuard, obraGuard, proyectosGestionGuard } from './core/guards/module.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },

  // Auth (no guards)
  {
    path: 'auth/login',
    loadComponent: () => import('./pages/auth/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'auth/reset',
    loadComponent: () => import('./pages/auth/reset/reset').then((m) => m.ResetPage),
  },
  {
    path: 'auth/set-password',
    loadComponent: () =>
      import('./pages/auth/set-password/set-password').then((m) => m.SetPasswordPage),
  },

  // PIN setup / unlock — require a session but not yet "unlocked".
  {
    path: 'auth/pin-setup',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/auth/pin-setup/pin-setup').then((m) => m.PinSetupPage),
  },
  {
    path: 'auth/pin',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/auth/pin-unlock/pin-unlock').then((m) => m.PinUnlockPage),
  },
  {
    // X10 — cambiar el PIN estando ya dentro (Ajustes). Requiere sesión + desbloqueado.
    path: 'auth/pin-change',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/auth/pin-change/pin-change').then((m) => m.PinChangePage),
  },

  // App (session + PIN unlocked)
  {
    path: 'home',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: 'bitacora',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () => import('./pages/bitacora/bitacora').then((m) => m.BitacoraPage),
  },
  {
    path: 'bitacora/parte',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () => import('./pages/bitacora/parte/parte').then((m) => m.PartePage),
  },
  {
    path: 'bitacora/incidente',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () => import('./pages/bitacora/incidente/incidente').then((m) => m.IncidentePage),
  },
  {
    path: 'bitacora/liberacion',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () =>
      import('./pages/bitacora/liberacion/liberacion').then((m) => m.LiberacionPage),
  },
  {
    path: 'bitacora/mis-partes',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () =>
      import('./pages/bitacora/mis-partes/mis-partes').then((m) => m.MisPartesPage),
  },
  {
    path: 'bitacora/detalle/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () =>
      import('./pages/bitacora/detalle/detalle').then((m) => m.BitacoraDetallePage),
  },
  {
    // Q5 (3b) — bandeja de liberaciones por firmar.
    path: 'bitacora/cl',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () => import('./pages/bitacora/cl-firmas/cl-firmas').then((m) => m.ClFirmasPage),
  },
  {
    // Q5 (3b) — detalle de un CL para revisarlo y firmar (deep-link del aviso).
    path: 'bitacora/cl/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('bitacora')],
    loadComponent: () => import('./pages/bitacora/cl-detalle/cl-detalle').then((m) => m.ClDetallePage),
  },
  {
    path: 'transporte',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/transporte').then((m) => m.TransportePage),
  },
  {
    // AN2 — lista de vehículos: consulta con permiso Ver (o módulo flota).
    path: 'transporte/vehiculos',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.vehiculos')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculos').then((m) => m.VehiculosListaPage),
  },
  {
    // AN2 — alta/edición: requiere Operar (el módulo flota lo hereda como operar).
    path: 'transporte/vehiculos/nuevo',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.vehiculos', 'operar')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculo-form').then((m) => m.VehiculoFormPage),
  },
  {
    path: 'transporte/vehiculos/:vehiculoId/editar',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.vehiculos', 'operar')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculo-form').then((m) => m.VehiculoFormPage),
  },
  {
    path: 'transporte/avisos',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/avisos/avisos').then((m) => m.AvisosFlotaPage),
  },
  {
    // AN2 — perfil del vehículo (consulta): permiso Ver o módulo flota.
    path: 'transporte/vehiculo/:vehiculoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.vehiculos')],
    loadComponent: () =>
      import('./pages/transporte/perfil-vehiculo/perfil-vehiculo').then((m) => m.PerfilVehiculoPage),
  },
  {
    // S22 — reportar accidente o daño de un vehículo.
    path: 'transporte/vehiculo/:vehiculoId/reportar',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/reportar-vehiculo/reportar-vehiculo').then((m) => m.ReportarVehiculoPage),
  },
  {
    // S24 — registrar una multa de un conductor.
    path: 'transporte/conductor/:conductorId/multa',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/reportar-multa/reportar-multa').then((m) => m.ReportarMultaPage),
  },
  {
    // Y7 — cuadro "Multas" del hub: registrar una multa eligiendo el conductor aquí.
    path: 'transporte/multa',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/reportar-multa/reportar-multa').then((m) => m.ReportarMultaPage),
  },
  {
    // AN2 — lista de conductores (consulta): permiso Ver o módulo flota.
    path: 'transporte/conductores',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.conductores')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductores').then((m) => m.ConductoresListaPage),
  },
  {
    path: 'transporte/conductores/nuevo',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.conductores', 'operar')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductor-form').then((m) => m.ConductorFormPage),
  },
  {
    path: 'transporte/conductores/:conductorId/editar',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.conductores', 'operar')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductor-form').then((m) => m.ConductorFormPage),
  },
  {
    // AN2 — perfil del conductor (consulta): permiso Ver o módulo flota.
    path: 'transporte/conductor/:conductorId',
    canActivate: [authGuard, pinGuard, submoduleGuard('flota.conductores')],
    loadComponent: () =>
      import('./pages/transporte/perfil-conductor/perfil-conductor').then((m) => m.PerfilConductorPage),
  },
  {
    path: 'transporte/mi-actividad',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mi-actividad/mi-actividad').then((m) => m.MiActividadPage),
  },
  {
    // V2 (follow-up) — detalle de un registro del historial (checklist | echada).
    path: 'transporte/mi-registro/:tipo/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mi-registro/mi-registro-detalle').then((m) => m.MiRegistroDetallePage),
  },
  {
    // Y7 — historial de checklists (jefe de flota ve lo que envía el chofer).
    path: 'transporte/checklists',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/checklists-historial/checklists-historial').then((m) => m.ChecklistsHistorialPage),
  },
  {
    path: 'transporte/rutas/crear',
    // AY11 — flota (chofer/jefe) O ingeniería (referente planifica una solicitud sin flota).
    canActivate: [authGuard, pinGuard, moduleAnyGuard(['flota', 'ingenieria'])],
    loadComponent: () => import('./pages/transporte/rutas/crear-ruta').then((m) => m.CrearRutaPage),
  },
  {
    path: 'transporte/reporte-semanal',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/reporte-semanal/reporte-semanal').then((m) => m.ReporteSemanalPage),
  },
  {
    path: 'transporte/asignar',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/asignar/asignar').then((m) => m.AsignarVehiculoPage),
  },
  {
    // AK15 — "Uso de vehículo" v2 (reemplaza asignarme/pre-uso/recibir): nivel de
    // gasolina + inicia/recibe/suelta sesión de uso. Con o sin vehículo en contexto.
    path: 'transporte/uso-vehiculo',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/uso-vehiculo/uso-vehiculo').then((m) => m.UsoVehiculoPage),
  },
  {
    path: 'transporte/uso-vehiculo/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/uso-vehiculo/uso-vehiculo').then((m) => m.UsoVehiculoPage),
  },
  {
    // AF34 — flujo unificado "Asignarme vehículo" + pre-uso + traspaso (acta).
    // AK20 — DEPRECADO por "Uso de vehículo" v2. AX10 — la pantalla vieja se RETIRA:
    // la ruta redirige a la canónica (los deep-links viejos conservan ?vehiculoId /
    // ?returnUrl automáticamente). El componente `asignarme` queda sin uso.
    path: 'transporte/asignarme',
    redirectTo: 'transporte/uso-vehiculo',
    pathMatch: 'full',
  },
  {
    // AF36 — historial de recepciones/traspasos de vehículo (actas).
    path: 'transporte/mis-actas',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mis-actas/mis-actas').then((m) => m.MisActasPage),
  },
  {
    // AH14 — detalle completo de un acta (condiciones + fallas voz/foto + firmas).
    path: 'transporte/acta/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/acta-detalle/acta-detalle').then((m) => m.ActaDetallePage),
  },
  // AD6 — funciones de inventario del chofer DENTRO de Transporte (gate por 'flota',
  // no 'inventario'): así funcionan aunque se revierta el acceso temporal a Inventario.
  {
    path: 'transporte/ferreteria',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/ferreteria/ferreteria').then((m) => m.FerreteriaPage),
  },
  {
    // AE — el chofer GENERA un conduce (salida de material) desde el móvil.
    path: 'transporte/generar-conduce',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/generar-conduce/generar-conduce').then((m) => m.GenerarConducePage),
  },
  {
    // BA/Transporte v3 (FASE 1) — conduce externo (un proveedor transporta). El
    // servidor exige puede_crear_conduce (admin/inventario/chofer) — defensa en capa.
    path: 'transporte/conduce-externo',
    canActivate: [authGuard, pinGuard, moduleAnyGuard(['flota', 'inventario'])],
    loadComponent: () =>
      import('./pages/transporte/conduce-externo/conduce-externo').then((m) => m.ConduceExternoPage),
  },
  {
    // BA/Transporte v3 (FASE 2) — requisiciones "por despachar" (el chofer jala).
    path: 'transporte/despachos',
    canActivate: [authGuard, pinGuard, moduleAnyGuard(['flota', 'inventario'])],
    loadComponent: () => import('./pages/transporte/despachos/despachos').then((m) => m.DespachosPage),
  },
  {
    // AE — devolver material (obra→almacén) con doble firma.
    path: 'transporte/devolver-material',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/devolver-material/devolver-material').then((m) => m.DevolverMaterialPage),
  },
  {
    // AE — bandeja de avisos in-app (sgc.notificaciones). Para cualquier usuario.
    path: 'avisos',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/avisos/avisos').then((m) => m.AvisosPage),
  },
  {
    // BD2 — "Por firmar" se fusionó en la bandeja canónica "Entregas por recibir"
    // (/transporte/por-confirmar). Se conserva el path como REDIRECT para no romper
    // deep-links viejos (avisos/push que apuntaban aquí).
    path: 'transporte/por-firmar',
    redirectTo: 'transporte/por-confirmar',
    pathMatch: 'full',
  },
  {
    // AJ5 — Mensajería (mismo modelo que la web). General para todos los roles.
    path: 'mensajes',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/mensajes').then((m) => m.MensajesPage),
  },
  {
    // AS25 — creación de grupo tipo WhatsApp (pantalla completa). Antes de :id.
    path: 'mensajes/nuevo-grupo',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/nuevo-grupo/nuevo-grupo').then((m) => m.NuevoGrupoPage),
  },
  {
    // AN6 — info/gestión de un grupo tipo WhatsApp (antes de :id para no chocar).
    path: 'mensajes/:id/info',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/grupo-info/grupo-info').then((m) => m.GrupoInfoPage),
  },
  {
    path: 'mensajes/:id',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/thread/thread').then((m) => m.MensajesThreadPage),
  },
  {
    // FASE 4 — "Compa" (asistente de IA). General para todo usuario autenticado
    // (como Mensajería): sin moduleGuard. Reutiliza la edge `assistant` (hereda
    // los permisos del usuario server-side).
    path: 'compa',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/compa/compa').then((m) => m.CompaPage),
  },
  {
    // AJ8 — bandeja del RECEPTOR: entregas que debe confirmar en SU teléfono.
    // Sin moduleGuard: el receptor puede ser inventario/obra sin módulo flota; el
    // RPC solo devuelve entregas donde el usuario actual es receptor autorizado.
    path: 'transporte/por-confirmar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/por-confirmar/por-confirmar').then((m) => m.PorConfirmarPage),
  },
  {
    // AU1 — bandeja del DESPACHANTE: conduces donde el usuario fue elegido
    // despachante y aún no firma. Sin moduleGuard: el despachante puede ser
    // cualquier usuario del sistema; el RPC solo devuelve los suyos (auth.uid()).
    path: 'transporte/conduces-por-firmar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/conduces-por-firmar/conduces-por-firmar').then(
        (m) => m.ConducesPorFirmarPage,
      ),
  },
  {
    // AY13 — "Conduces por implementar": conduces con ítems libres sin vincular.
    // Sin moduleGuard: el RPC filtra por permiso; read-only (el vínculo es del admin web).
    path: 'transporte/conduces-por-implementar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/conduces-por-implementar/conduces-por-implementar').then(
        (m) => m.ConducesPorImplementarPage,
      ),
  },
  {
    // AY11 — hub del módulo Ingeniería (concentra Solicitud de movimiento, etc.).
    path: 'ingenieria',
    canActivate: [authGuard, pinGuard, moduleGuard('ingenieria')],
    loadComponent: () => import('./pages/ingenieria/ingenieria').then((m) => m.IngenieriaPage),
  },
  {
    // AY11 — Solicitudes de movimiento (bandeja: propias del ingeniero / todas del referente).
    path: 'transporte/solicitudes-movimiento',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/solicitud-movimiento/solicitudes-movimiento').then(
        (m) => m.SolicitudesMovimientoPage,
      ),
  },
  {
    // AY11 — crear solicitud de movimiento (ingeniero, offline por outbox).
    path: 'transporte/crear-solicitud-movimiento',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/solicitud-movimiento/crear-solicitud-movimiento').then(
        (m) => m.CrearSolicitudMovimientoPage,
      ),
  },
  {
    // AU5 — "Ver trayectoria" (replay estático) de una ruta finalizada.
    path: 'transporte/trayectoria/:rutaId',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/trayectoria/trayectoria').then((m) => m.TrayectoriaPage),
  },
  {
    // AU7 — "Mi recorrido" diario del chofer (Timeline: trazo + paradas + offline).
    path: 'transporte/mi-recorrido',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/mi-recorrido/mi-recorrido').then((m) => m.MiRecorridoPage),
  },
  {
    // Reutiliza la pantalla de recibir conduce (mercancía/traslado) bajo Transporte.
    path: 'transporte/recibir-mercancia',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/inventario/recibir/recibir').then((m) => m.RecibirConducePage),
  },
  {
    path: 'transporte/recibir/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    data: { tipo: 'recepcion' },
    loadComponent: () =>
      import('./pages/transporte/checklist/checklist').then((m) => m.ChecklistPage),
  },
  {
    path: 'transporte/devolver/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    data: { tipo: 'devolucion' },
    loadComponent: () =>
      import('./pages/transporte/checklist/checklist').then((m) => m.ChecklistPage),
  },
  {
    // Z24 — "Hacer pre-uso" directo desde el hub (sin vehículo en contexto): la
    // pantalla muestra el selector del pool (necesitaVehiculo). ≤2 toques.
    path: 'transporte/preuso',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/preuso/preuso').then((m) => m.PreusoPage),
  },
  {
    path: 'transporte/preuso/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/preuso/preuso').then((m) => m.PreusoPage),
  },
  {
    // AG9 — hub de mantenimientos del vehículo (historial + registrar + cerrar).
    path: 'transporte/mantenimientos/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mantenimientos-lista/mantenimientos-lista').then(
        (m) => m.MantenimientosListaPage,
      ),
  },
  {
    path: 'transporte/mantenimiento/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mantenimiento/mantenimiento').then((m) => m.MantenimientoPage),
  },
  {
    // AG9 — cerrar un mantenimiento con costo/evidencia.
    path: 'transporte/mantenimiento/:vehiculoId/cerrar/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/mantenimiento-cierre/mantenimiento-cierre').then(
        (m) => m.MantenimientoCierrePage,
      ),
  },
  {
    // S26b — acceso directo "Registrar combustible" sin vehículo en contexto:
    // la pantalla muestra el selector del pool.
    path: 'transporte/combustible',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/combustible/combustible').then((m) => m.CombustiblePage),
  },
  {
    path: 'transporte/combustible/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/combustible/combustible').then((m) => m.CombustiblePage),
  },
  {
    // AF17 — "Registro de echadas" (roles elevados; el RPC log_combustible gatea por rol).
    path: 'transporte/combustible-log',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/combustible-log/combustible-log').then((m) => m.CombustibleLogPage),
  },
  {
    // AQ13/AQ6 — detalle de una echada (fila del registro + deep-link de consumo anormal).
    // La RLS de registros_combustible acota: elevado ve todas; el chofer, las suyas.
    path: 'transporte/echada/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/echada-detalle/echada-detalle').then((m) => m.EchadaDetallePage),
  },
  {
    path: 'transporte/conduces',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/conduces/conduces').then((m) => m.ConducesPage),
  },
  {
    // AF22 — Transporte v2 "Mis rutas" (activas / hoy / historial). Reutiliza la
    // pantalla de ejecución de rutas (misma que /transporte/conduces, que se
    // conserva para deep-links viejos).
    path: 'transporte/mis-rutas',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/conduces/conduces').then((m) => m.ConducesPage),
  },
  {
    // AF22 — núcleo "Conduces" (sub-hub: crear/recibir/devolver/ferretería/por firmar/historial).
    path: 'transporte/conduces-hub',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conduces-hub/conduces-hub').then((m) => m.ConducesHubPage),
  },
  {
    // AF27 — Seguimiento en vivo (jefe de flota / admin / tecnología). El RPC y la
    // RLS gatean por es_flota_elevado; la página además valida en cliente.
    path: 'transporte/seguimiento',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/seguimiento/seguimiento').then((m) => m.SeguimientoPage),
  },
  {
    // AP6 — Rutas activas (lista por chofer + histórico), roles elevados. El RPC y
    // la RLS gatean por es_flota_elevado; la página además valida en cliente.
    path: 'transporte/rutas-activas',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/rutas-activas/rutas-activas').then((m) => m.RutasActivasPage),
  },
  {
    // AK1 — Historial de confirmaciones de entrega (matriz de visibilidad server-side).
    // Sin moduleGuard: un ingeniero/responsable receptor puede no tener módulo flota;
    // el RPC confirmaciones_historial acota lo que ve cada usuario.
    path: 'transporte/confirmaciones',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/confirmaciones/confirmaciones').then((m) => m.ConfirmacionesPage),
  },
  {
    // AF29 — Historial de conduces (listado filtrable + detalle).
    path: 'transporte/conduces-historial',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conduces-historial/conduces-historial').then((m) => m.ConducesHistorialPage),
  },
  {
    // AI13 — Aviso de vehículo (reportar novedad + ver alertas del vehículo).
    path: 'transporte/aviso-vehiculo',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/aviso-vehiculo/aviso-vehiculo').then((m) => m.AvisoVehiculoPage),
  },
  {
    // AI2 — Pendiente entrega (conduces emitidos por entregar; entregar/transferir).
    path: 'transporte/conduces-pendientes',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conduces-pendientes/conduces-pendientes').then((m) => m.ConducesPendientesPage),
  },
  {
    // AL9/AL13/AL4 — detalle de un conduce (documento) abierto desde cualquier
    // listado. Sin moduleGuard: lo puede ver el receptor/confirmador (inventario/
    // obra) además del chofer; el RPC valida la visibilidad server-side.
    path: 'transporte/conduce-detalle/:salidaId',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/transporte/conduce-detalle/conduce-detalle').then((m) => m.ConduceDetallePage),
  },
  {
    // AH5 — inbox de transferencias de conduce (aceptar con foto+firma / rechazar).
    path: 'transporte/conduce-transferencias',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conduce-transferencias/conduce-transferencias').then((m) => m.ConduceTransferenciasPage),
  },
  {
    path: 'transporte/conduces/:salidaId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conduces/entrega/entrega').then((m) => m.ConduceEntregaPage),
  },
  {
    path: 'inventario',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/inventario').then((m) => m.InventarioPage),
  },
  {
    // AU4 — bandeja de material NO catalogado (solo lectura). Sin moduleGuard: el
    // RPC gatea por admin/inventario y devuelve [] a otros; destino del push
    // 'material_no_catalogado'.
    path: 'inventario/material-no-catalogado',
    canActivate: [authGuard, pinGuard],
    loadComponent: () =>
      import('./pages/inventario/material-no-catalogado/material-no-catalogado').then(
        (m) => m.MaterialNoCatalogadoPage,
      ),
  },
  {
    // AS20 — catálogo global de artículos (solo lectura): buscador nombre/código,
    // filtro por categoría, detalle con stock por almacén + kardex.
    path: 'inventario/catalogo',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () => import('./pages/inventario/catalogo/catalogo').then((m) => m.CatalogoPage),
  },
  {
    // AN2 — existencias (consulta): permiso Ver de artículos o módulo inventario.
    path: 'inventario/existencias',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () =>
      import('./pages/inventario/existencias/existencias').then((m) => m.ExistenciasPage),
  },
  {
    // Z17 — detalle de artículo (foto, código, categoría, propiedad, stock)
    path: 'inventario/articulo/:id',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () =>
      import('./pages/inventario/articulo-detalle/articulo-detalle').then((m) => m.ArticuloDetallePage),
  },
  {
    // AS20 — crear artículo nuevo (código auto + fotos). Gate: operar sobre artículos.
    path: 'inventario/articulo-nuevo',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos', 'operar')],
    loadComponent: () =>
      import('./pages/inventario/articulo-nuevo/articulo-nuevo').then((m) => m.ArticuloNuevoPage),
  },
  {
    // AS20 — editar artículo (campos + imagen). Gate: operar sobre artículos
    // (admin o módulo inventario); el RPC lo vuelve a validar server-side.
    path: 'inventario/articulo/:id/editar',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos', 'operar')],
    loadComponent: () =>
      import('./pages/inventario/articulo-editar/articulo-editar').then((m) => m.ArticuloEditarPage),
  },
  {
    // AP2 — inventario de un almacén (artículos + existencias + apertura). Doble
    // gate: submódulo Ver + verdad server-side (`puede_ver_inventario_bodega`).
    path: 'inventario/almacen/:bodegaId',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () =>
      import('./pages/inventario/almacen-inventario/almacen-inventario').then((m) => m.AlmacenInventarioPage),
  },
  {
    // AP2 — selector de almacén cuando se entra sin bodega fija (desde el hub).
    path: 'inventario/almacen',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () =>
      import('./pages/inventario/almacen-inventario/almacen-inventario').then((m) => m.AlmacenInventarioPage),
  },
  {
    // AP3 — kardex por artículo×almacén (histórico de movimientos + timeline).
    path: 'inventario/kardex/:bodegaId/:articuloId',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.articulos')],
    loadComponent: () => import('./pages/inventario/kardex/kardex').then((m) => m.KardexPage),
  },
  {
    // AN2 — registrar salida: requiere Operar del submódulo salidas.
    path: 'inventario/salida',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.salidas', 'operar')],
    loadComponent: () => import('./pages/inventario/salida/salida').then((m) => m.SalidaPage),
  },
  {
    path: 'inventario/entrada',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.entradas', 'operar')],
    loadComponent: () => import('./pages/inventario/entrada/entrada').then((m) => m.EntradaPage),
  },
  {
    path: 'inventario/recibir',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.entradas', 'operar')],
    loadComponent: () =>
      import('./pages/inventario/recibir/recibir').then((m) => m.RecibirConducePage),
  },
  {
    path: 'inventario/conteo',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.conteos', 'operar')],
    loadComponent: () => import('./pages/inventario/conteo/conteo').then((m) => m.ConteoPage),
  },
  {
    // Y10 — "Conteo y ajustes": historial (consulta): permiso Ver de conteos.
    path: 'inventario/conteos',
    canActivate: [authGuard, pinGuard, submoduleGuard('inventario.conteos')],
    loadComponent: () => import('./pages/inventario/conteos/conteos').then((m) => m.ConteosPage),
  },
  {
    path: 'inventario/almacenes',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/almacenes/almacenes').then((m) => m.AlmacenesPage),
  },
  {
    // AY3 — la Requisición se gatea por SUBMÓDULO `compras.solicitudes` (no por el
    // módulo `compras` completo): el rol Ingenieros ORIGINA requisiciones sin
    // gestionar órdenes/proveedores. Los que tienen el módulo `compras` completo
    // pasan igual (retrocompat: módulo padre ⇒ operar en sus submódulos).
    path: 'solicitudes',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes')],
    loadComponent: () => import('./pages/solicitudes/solicitudes').then((m) => m.SolicitudesPage),
  },
  {
    path: 'solicitudes/pedir',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes', 'operar')],
    loadComponent: () => import('./pages/solicitudes/pedir/pedir').then((m) => m.PedirPage),
  },
  {
    path: 'solicitudes/mis',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes')],
    loadComponent: () => import('./pages/solicitudes/mis/mis').then((m) => m.MisSolicitudesPage),
  },
  {
    // AS7 — bandeja de TODAS las requisiciones (aprobar): sigue siendo del módulo
    // `compras` completo (coordinador de compras), NO del ingeniero que solo origina.
    // El gate server-side por rol confirma; la página muestra "sin acceso" si lo niega.
    path: 'solicitudes/bandeja',
    canActivate: [authGuard, pinGuard, moduleGuard('compras')],
    loadComponent: () => import('./pages/solicitudes/bandeja/bandeja').then((m) => m.RequisicionesBandejaPage),
  },
  {
    path: 'solicitudes/requisicion/:id',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes')],
    loadComponent: () => import('./pages/solicitudes/detalle/detalle').then((m) => m.RequisicionDetallePage),
  },

  // BG4 — Retiro de material dañado (lo origina el ingeniero de la obra, mismo
  // público que las requisiciones → submódulo compras.solicitudes).
  {
    path: 'inventario/retiros',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes')],
    loadComponent: () => import('./pages/inventario/retiros/retiros').then((m) => m.RetirosPage),
  },
  {
    path: 'inventario/retiro/nuevo',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes', 'operar')],
    loadComponent: () => import('./pages/inventario/retiro-nuevo/retiro-nuevo').then((m) => m.RetiroNuevoPage),
  },
  {
    path: 'inventario/retiro/:id',
    canActivate: [authGuard, pinGuard, submoduleGuard('compras.solicitudes')],
    loadComponent: () => import('./pages/inventario/retiro-detalle/retiro-detalle').then((m) => m.RetiroDetallePage),
  },

  {
    path: 'actualizar',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/actualizar/actualizar').then((m) => m.ActualizarPage),
  },
  {
    // AT2 — "Mi rendimiento" del chofer (informe de incentivo propio). Destino de
    // la push del lunes (ruta '/mi-rendimiento'). AV2 — solo Chofer y Jefe de flota
    // participan del incentivo: roleAnyGuard cierra el deep-link para el resto
    // (defensa en profundidad; el menú ya lo oculta vía puedeVerMiRendimiento).
    path: 'mi-rendimiento',
    canActivate: [authGuard, pinGuard, roleAnyGuard(['chofer_transportista', 'jefe_flota'])],
    loadComponent: () => import('./pages/mi-rendimiento/mi-rendimiento').then((m) => m.MiRendimientoPage),
  },
  {
    // AT3 — "Gestión del incentivo" (logística/gerencia/admin): aprobar/declinar el
    // incentivo de cada chofer. Sin moduleGuard: la página se auto-gatea con
    // puede_gestionar_incentivos() (quien no tenga permiso ve "Sin acceso").
    path: 'incentivos',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/incentivos/incentivos').then((m) => m.IncentivosPage),
  },
  {
    path: 'perfil',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/perfil/perfil').then((m) => m.PerfilPage),
  },
  {
    // Z26 — detalle de mi propio usuario (solo lectura): datos, rol, licencia,
    // última actividad, documentos. Sin gate de módulo (todo usuario tiene perfil).
    path: 'perfil/mi-detalle',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/perfil/mi-detalle/mi-detalle').then((m) => m.MiDetallePage),
  },
  {
    path: 'pendientes',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/pendientes/pendientes').then((m) => m.PendientesPage),
  },
  {
    // BG3 — vista de solo-lectura del contenido de un pendiente (+ duplicar / exportar).
    path: 'pendientes/:id',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/pendientes/outbox-detalle/outbox-detalle').then((m) => m.OutboxDetallePage),
  },
  {
    path: 'en-proceso',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/en-proceso/en-proceso').then((m) => m.EnProcesoPage),
  },
  {
    path: 'reportar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/reportar/reportar').then((m) => m.ReportarPage),
  },
  {
    path: 'soporte',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/soporte/soporte').then((m) => m.SoportePage),
  },
  {
    path: 'admin',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminPage),
  },
  {
    // Z26 — Tecnología la ve TODO usuario (Historial de versiones, Guía, Dudas).
    // Los submódulos restringidos ("Versiones de App", "Reportes de errores") se
    // gatean POR ROL dentro de la página (ctx.esTecnologia), no por módulo.
    path: 'tecnologia',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/tecnologia/tecnologia').then((m) => m.TecnologiaPage),
  },
  // AL2 — Inventario tecnológico (módulo Tecnología real). Gating admin|tecnologia.
  {
    path: 'tecnologia-inventario',
    canActivate: [authGuard, pinGuard, moduleGuard('tecnologia')],
    loadComponent: () =>
      import('./pages/tecnologia-inventario/tecnologia-inventario').then((m) => m.TecnologiaInventarioPage),
  },
  {
    path: 'tecnologia-inventario/nuevo',
    canActivate: [authGuard, pinGuard, moduleGuard('tecnologia')],
    loadComponent: () =>
      import('./pages/tecnologia-inventario/equipo-form/equipo-form').then((m) => m.TecEquipoFormPage),
  },
  {
    path: 'tecnologia-inventario/:id/editar',
    canActivate: [authGuard, pinGuard, moduleGuard('tecnologia')],
    loadComponent: () =>
      import('./pages/tecnologia-inventario/equipo-form/equipo-form').then((m) => m.TecEquipoFormPage),
  },
  {
    path: 'tecnologia-inventario/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('tecnologia')],
    loadComponent: () =>
      import('./pages/tecnologia-inventario/equipo-detalle/equipo-detalle').then((m) => m.TecEquipoDetallePage),
  },
  {
    // AC4 — Notas: módulo general accesible por todos (sin moduleGuard).
    path: 'notas',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/notas/notas').then((m) => m.NotasPage),
  },
  {
    // AF39 — Tareas: general (el RPC mis_tareas_app acota lo que ve cada usuario).
    path: 'tareas',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/tareas/tareas').then((m) => m.TareasPage),
  },
  {
    // AH15 — consulta de Compras del proyecto (el RPC compras_de_proyecto acota acceso).
    path: 'compras-proyecto',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/compras-proyecto/compras-proyecto').then((m) => m.ComprasProyectoPage),
  },
  {
    // AH16 — RRHH: empleados (consulta) para el jefe de RRHH.
    path: 'rrhh/empleados',
    canActivate: [authGuard, pinGuard, moduleGuard('rrhh')],
    loadComponent: () => import('./pages/rrhh/empleados/rrhh-empleados').then((m) => m.RrhhEmpleadosPage),
  },
  {
    // AH16 — RRHH: ficha del empleado + asignaciones (AF33).
    path: 'rrhh/empleado/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('rrhh')],
    loadComponent: () => import('./pages/rrhh/empleado/rrhh-empleado').then((m) => m.RrhhEmpleadoPage),
  },
  {
    path: 'notas/:id',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/notas/editor/nota-editor').then((m) => m.NotaEditorPage),
  },
  {
    // Y14 — Proyectos (listado). AY4 — gateado por SUBMÓDULO `proyectos.obras`:
    // el rol Ingenieros ve SUS obras (ver) sin tener el módulo `proyectos` completo;
    // los que tienen el módulo pasan igual (retrocompat módulo⇒operar). La RLS scopea
    // los datos a las obras del usuario (responsable/adjunto/empleado).
    path: 'proyectos',
    canActivate: [authGuard, pinGuard, submoduleGuard('proyectos.obras')],
    loadComponent: () => import('./pages/proyectos/proyectos').then((m) => m.ProyectosPage),
  },
  {
    // Y15 (FASE 5) — bandeja de avisos de cronograma (antes de :id para no chocar).
    path: 'proyectos/avisos',
    canActivate: [authGuard, pinGuard, submoduleGuard('proyectos.cronograma')],
    loadComponent: () =>
      import('./pages/proyectos/avisos/cronograma-avisos').then((m) => m.CronogramaAvisosPage),
  },
  {
    // AM9 — crear proyecto (por hojas, con ubicación fácil). Antes de :id. AY4c — solo
    // quien GESTIONA proyectos (el Ingeniero de Oficina ve todo pero es solo-lectura).
    path: 'proyectos/nuevo',
    canActivate: [authGuard, pinGuard, proyectosGestionGuard],
    loadComponent: () => import('./pages/proyectos/form/proyecto-form').then((m) => m.ProyectoFormPage),
  },
  // AR1 — Registro de Personal de obra (submódulo proyectos.personal). Antes de
  // 'proyectos/:id' para que 'personal' no se tome como un id. Sin moduleGuard: la
  // visibilidad es obra-scoped y la fuerza la RLS (elevados todo; ingeniero/capataz
  // su obra) — como por-confirmar/confirmaciones; el tile/FAB gatean en cliente.
  {
    path: 'proyectos/personal',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/proyectos/personal/personal-lista').then((m) => m.PersonalListaPage),
  },
  {
    path: 'proyectos/personal/registrar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/proyectos/personal/personal-registro').then((m) => m.PersonalRegistroPage),
  },
  {
    path: 'proyectos/personal/:id',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/proyectos/personal/personal-expediente').then((m) => m.PersonalExpedientePage),
  },
  {
    // AY4 — ficha del proyecto (ver): el ingeniero ve la ficha de SUS obras. Los
    // costos/finanzas se ocultan dentro de la página (puedeVerCostos, nivel operar).
    path: 'proyectos/:id',
    canActivate: [authGuard, pinGuard, submoduleGuard('proyectos.obras')],
    loadComponent: () =>
      import('./pages/proyectos/detalle/proyecto-detalle').then((m) => m.ProyectoDetallePage),
  },
  {
    // AM9 — editar proyecto existente (mismo wizard por hojas). AY4c — solo gestión.
    path: 'proyectos/:id/editar',
    canActivate: [authGuard, pinGuard, proyectosGestionGuard],
    loadComponent: () => import('./pages/proyectos/form/proyecto-form').then((m) => m.ProyectoFormPage),
  },
  {
    // Y15 — cronograma del proyecto (consulta + acciones offline-first). AY4 —
    // submódulo `proyectos.cronograma` (ver): el ingeniero ve el cronograma de su obra.
    path: 'proyectos/:id/cronograma',
    canActivate: [authGuard, pinGuard, submoduleGuard('proyectos.cronograma')],
    loadComponent: () =>
      import('./pages/proyectos/cronograma/cronograma').then((m) => m.CronogramaPage),
  },
  {
    // AS21 — importar el cronograma desde Excel (.xlsx). Importar = OPERAR.
    path: 'proyectos/:id/cronograma/importar',
    canActivate: [authGuard, pinGuard, submoduleGuard('proyectos.cronograma', 'operar')],
    loadComponent: () =>
      import('./pages/proyectos/cronograma/cronograma-importar').then((m) => m.CronogramaImportarPage),
  },
  {
    // AL2 — Administración completo: usuarios, roles/permisos, parámetros.
    path: 'admin/usuarios',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/usuarios/usuarios').then((m) => m.AdminUsuariosPage),
  },
  {
    path: 'admin/roles',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/roles/roles').then((m) => m.AdminRolesPage),
  },
  {
    path: 'admin/parametros',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/parametros/parametros').then((m) => m.AdminParametrosPage),
  },
  {
    path: 'admin/reportes',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/reportes/reportes').then((m) => m.AdminReportesPage),
  },
  {
    path: 'admin/unidades',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/unidades/unidades').then((m) => m.AdminUnidadesPage),
  },
  {
    path: 'admin/catalogos',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/catalogos/catalogos').then((m) => m.AdminCatalogosPage),
  },
  {
    path: 'admin/conteos',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/conteos/conteos').then((m) => m.AdminConteosPage),
  },
  {
    path: 'admin/auditoria',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/auditoria/auditoria').then((m) => m.AdminAuditoriaPage),
  },
  {
    path: 'admin/versiones',
    canActivate: [authGuard, pinGuard, moduleGuard('admin')],
    loadComponent: () => import('./pages/admin/versiones/versiones').then((m) => m.AdminVersionesPage),
  },
  // ── AG16 — Gestión de Producción de Obra ("Mi obra") ──────────────────────
  {
    path: 'obra',
    canActivate: [authGuard, pinGuard, obraGuard],
    loadComponent: () => import('./pages/obra/obra').then((m) => m.ObraPage),
  },
  {
    path: 'obra/plan/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.plan_dia')],
    loadComponent: () => import('./pages/obra/plan-dia/plan-dia').then((m) => m.PlanDiaPage),
  },
  {
    path: 'obra/charla/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.plan_dia', 'operar')],
    loadComponent: () => import('./pages/obra/charla/charla').then((m) => m.CharlaPage),
  },
  {
    path: 'obra/nc/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.no_conformidades', 'operar')],
    loadComponent: () => import('./pages/obra/no-conformidad/no-conformidad').then((m) => m.NoConformidadPage),
  },
  {
    path: 'obra/incidente/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.no_conformidades', 'operar')],
    loadComponent: () => import('./pages/obra/incidente/incidente').then((m) => m.IncidentePage),
  },
  {
    path: 'obra/mis-nc',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.no_conformidades')],
    loadComponent: () => import('./pages/obra/mis-nc/mis-nc').then((m) => m.MisNcPage),
  },
  {
    path: 'obra/checklists/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.checklists', 'operar')],
    loadComponent: () => import('./pages/obra/checklists/checklists').then((m) => m.ChecklistsPage),
  },
  {
    path: 'obra/recursos/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.plan_dia')],
    loadComponent: () => import('./pages/obra/recursos/recursos').then((m) => m.RecursosPage),
  },
  {
    path: 'obra/subcontratistas/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.subcontratistas', 'operar')],
    loadComponent: () => import('./pages/obra/subcontratistas/subcontratistas').then((m) => m.SubcontratistasPage),
  },
  {
    path: 'obra/avance/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.avance')],
    loadComponent: () => import('./pages/obra/avance/avance').then((m) => m.AvancePage),
  },
  {
    path: 'obra/logistica/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.avance')],
    loadComponent: () => import('./pages/obra/logistica/logistica').then((m) => m.LogisticaPage),
  },
  {
    path: 'obra/informe/:proyectoId',
    canActivate: [authGuard, pinGuard, submoduleGuard('obra.informes')],
    loadComponent: () => import('./pages/obra/informe/informe').then((m) => m.InformePage),
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: 'home' },
];
