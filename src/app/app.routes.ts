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
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: 'home' },
];
