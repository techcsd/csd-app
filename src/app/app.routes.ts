import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { pinGuard } from './core/guards/pin.guard';
import { moduleGuard, submoduleGuard, obraGuard } from './core/guards/module.guard';

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
    path: 'transporte/vehiculos',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculos').then((m) => m.VehiculosListaPage),
  },
  {
    path: 'transporte/vehiculos/nuevo',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculo-form').then((m) => m.VehiculoFormPage),
  },
  {
    path: 'transporte/vehiculos/:vehiculoId/editar',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/vehiculos/vehiculo-form').then((m) => m.VehiculoFormPage),
  },
  {
    path: 'transporte/avisos',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/avisos/avisos').then((m) => m.AvisosFlotaPage),
  },
  {
    path: 'transporte/vehiculo/:vehiculoId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
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
    path: 'transporte/conductores',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductores').then((m) => m.ConductoresListaPage),
  },
  {
    path: 'transporte/conductores/nuevo',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductor-form').then((m) => m.ConductorFormPage),
  },
  {
    path: 'transporte/conductores/:conductorId/editar',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/conductores/conductor-form').then((m) => m.ConductorFormPage),
  },
  {
    path: 'transporte/conductor/:conductorId',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
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
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
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
    // AK20 — DEPRECADO: ya no se enlaza desde el menú (Uso de vehículo lo reemplaza);
    // la ruta se conserva para no romper deep-links viejos.
    path: 'transporte/asignarme',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () =>
      import('./pages/transporte/asignarme/asignarme').then((m) => m.AsignarmeVehiculoPage),
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
    // AE — bandeja "Por firmar" (firmas de recepción pendientes asignadas a mí).
    // Sin moduleGuard: el receptor puede ser un ingeniero sin módulo flota; el RPC
    // solo devuelve lo asignado al usuario actual (auth.uid()).
    path: 'transporte/por-firmar',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/transporte/por-firmar/por-firmar').then((m) => m.PorFirmarPage),
  },
  {
    // AJ5 — Mensajería (mismo modelo que la web). General para todos los roles.
    path: 'mensajes',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/mensajes').then((m) => m.MensajesPage),
  },
  {
    path: 'mensajes/:id',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/mensajes/thread/thread').then((m) => m.MensajesThreadPage),
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
    path: 'inventario/existencias',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () =>
      import('./pages/inventario/existencias/existencias').then((m) => m.ExistenciasPage),
  },
  {
    // Z17 — detalle de artículo (foto, código, categoría, propiedad, stock)
    path: 'inventario/articulo/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () =>
      import('./pages/inventario/articulo-detalle/articulo-detalle').then((m) => m.ArticuloDetallePage),
  },
  {
    path: 'inventario/salida',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/salida/salida').then((m) => m.SalidaPage),
  },
  {
    path: 'inventario/entrada',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/entrada/entrada').then((m) => m.EntradaPage),
  },
  {
    path: 'inventario/recibir',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () =>
      import('./pages/inventario/recibir/recibir').then((m) => m.RecibirConducePage),
  },
  {
    path: 'inventario/conteo',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/conteo/conteo').then((m) => m.ConteoPage),
  },
  {
    // Y10 — "Conteo y ajustes": historial de conteos/ajustes de inventario.
    path: 'inventario/conteos',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/conteos/conteos').then((m) => m.ConteosPage),
  },
  {
    path: 'inventario/almacenes',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/almacenes/almacenes').then((m) => m.AlmacenesPage),
  },
  {
    path: 'solicitudes',
    canActivate: [authGuard, pinGuard, moduleGuard('compras')],
    loadComponent: () => import('./pages/solicitudes/solicitudes').then((m) => m.SolicitudesPage),
  },
  {
    path: 'solicitudes/pedir',
    canActivate: [authGuard, pinGuard, moduleGuard('compras')],
    loadComponent: () => import('./pages/solicitudes/pedir/pedir').then((m) => m.PedirPage),
  },
  {
    path: 'solicitudes/mis',
    canActivate: [authGuard, pinGuard, moduleGuard('compras')],
    loadComponent: () => import('./pages/solicitudes/mis/mis').then((m) => m.MisSolicitudesPage),
  },

  {
    path: 'actualizar',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/actualizar/actualizar').then((m) => m.ActualizarPage),
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
    // Y14 — Proyectos (listado), gateado por el módulo `proyectos`.
    path: 'proyectos',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () => import('./pages/proyectos/proyectos').then((m) => m.ProyectosPage),
  },
  {
    // Y15 (FASE 5) — bandeja de avisos de cronograma (antes de :id para no chocar).
    path: 'proyectos/avisos',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () =>
      import('./pages/proyectos/avisos/cronograma-avisos').then((m) => m.CronogramaAvisosPage),
  },
  {
    // AM9 — crear proyecto (por hojas, con ubicación fácil). Antes de :id.
    path: 'proyectos/nuevo',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () => import('./pages/proyectos/form/proyecto-form').then((m) => m.ProyectoFormPage),
  },
  {
    path: 'proyectos/:id',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () =>
      import('./pages/proyectos/detalle/proyecto-detalle').then((m) => m.ProyectoDetallePage),
  },
  {
    // AM9 — editar proyecto existente (mismo wizard por hojas).
    path: 'proyectos/:id/editar',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () => import('./pages/proyectos/form/proyecto-form').then((m) => m.ProyectoFormPage),
  },
  {
    // Y15 — cronograma del proyecto (consulta + acciones offline-first).
    path: 'proyectos/:id/cronograma',
    canActivate: [authGuard, pinGuard, moduleGuard('proyectos')],
    loadComponent: () =>
      import('./pages/proyectos/cronograma/cronograma').then((m) => m.CronogramaPage),
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
