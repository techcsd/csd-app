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
    path: 'inventario',
    canActivate: [authGuard, pinGuard, moduleGuard('inventario')],
    loadComponent: () => import('./pages/inventario/inventario').then((m) => m.InventarioPage),
  },
  {
    path: 'solicitudes',
    canActivate: [authGuard, pinGuard, moduleGuard('compras')],
    loadComponent: () => import('./pages/solicitudes/solicitudes').then((m) => m.SolicitudesPage),
  },

  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
  },
  { path: '**', redirectTo: 'home' },
];
