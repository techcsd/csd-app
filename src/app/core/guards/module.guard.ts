import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserContextService } from '../services/user-context.service';

/** Gates a route by an SGC module key (roles.modulos) — same as SGC web. */
export const moduleGuard = (modulo: string): CanActivateFn => {
  return () => {
    const ctx = inject(UserContextService);
    const router = inject(Router);
    return ctx.hasModulo(modulo) ? true : router.createUrlTree(['/403']);
  };
};

/** AY11 — gate por CUALQUIERA de varios módulos (ej. crear-ruta = flota O ingeniería:
 *  el referente de movimiento planifica sin tener el módulo flota completo). */
export const moduleAnyGuard = (modulos: string[]): CanActivateFn => {
  return () => {
    const ctx = inject(UserContextService);
    const router = inject(Router);
    return modulos.some((m) => ctx.hasModulo(m)) ? true : router.createUrlTree(['/403']);
  };
};

/** AV2 — gate por CUALQUIERA de varios roles (roles.codigo). Usado por
 *  "Mi rendimiento": solo Chofer y Jefe de flota participan del incentivo. */
export const roleAnyGuard = (codigos: string[]): CanActivateFn => {
  return () => {
    const ctx = inject(UserContextService);
    const router = inject(Router);
    return codigos.some((c) => ctx.hasRol(c)) ? true : router.createUrlTree(['/403']);
  };
};

/**
 * AG12 — gates a route by an `modulo.submodulo` key at the given level (mirror of
 * `puede_ver/operar_submodulo`). Needed for `obra.*` because the `capataz` role has
 * NO top-level module, only submodule `permisos`. Falls back to the module gate.
 */
export const submoduleGuard = (clave: string, nivel: 'ver' | 'operar' = 'ver'): CanActivateFn => {
  return () => {
    const ctx = inject(UserContextService);
    const router = inject(Router);
    const ok = nivel === 'operar' ? ctx.puedeOperarSubmodulo(clave) : ctx.puedeVerSubmodulo(clave);
    return ok ? true : router.createUrlTree(['/403']);
  };
};

/** Obra module gate: visible to anyone with the `obra` module OR any `obra.*` permiso. */
export const obraGuard: CanActivateFn = () => {
  const ctx = inject(UserContextService);
  const router = inject(Router);
  return ctx.puedeVerObra() ? true : router.createUrlTree(['/403']);
};
