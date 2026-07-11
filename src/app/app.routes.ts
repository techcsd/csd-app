import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { pinGuard } from './core/guards/pin.guard';
import { moduleGuard } from './core/guards/module.guard';

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
    path: 'transporte',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/transporte').then((m) => m.TransportePage),
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
    path: 'transporte/conduces',
    canActivate: [authGuard, pinGuard, moduleGuard('flota')],
    loadComponent: () => import('./pages/transporte/conduces/conduces').then((m) => m.ConducesPage),
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
    path: 'perfil',
    canActivate: [authGuard, pinGuard],
    loadComponent: () => import('./pages/perfil/perfil').then((m) => m.PerfilPage),
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
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: 'home' },
];
