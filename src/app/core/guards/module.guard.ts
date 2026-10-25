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

/** CSD-importar — gate por rol "flota elevado" (mirror de `UserContextService.esFlotaElevado`,
 *  que a su vez espeja `sgc.es_flota_elevado()`). NUNCA duplicar la lista de roles aquí. */
export const flotaElevadoGuard: CanActivateFn = () => {
  const ctx = inject(UserContextService);
  const router = inject(Router);
  return ctx.esFlotaElevado() ? true : router.createUrlTree(['/403']);
};

/**
 * CW6/CW7 — un chofer_privado restringido (sin transportista ni flota-elevado) NO
 * usa conduces/rutas de EMPRESA (solo su propio vehículo/combustible/inspección):
 * bloquea el deep-link directo a estas pantallas (antes el moduleGuard('flota')
 * lo dejaba pasar porque SÍ tiene el módulo flota) con el mensaje fijo D6, en vez
 * de dejarlo entrar a un formulario que el servidor rechazará sin explicación.
 */
export const noConducesPrivadoGuard: CanActivateFn = () => {
  const ctx = inject(UserContextService);
  const router = inject(Router);
  return ctx.esChoferPrivadoRestringido()
    ? router.createUrlTree(['/403'], { queryParams: { motivo: 'chofer-privado' } })
    : true;
};

/** Obra module gate: visible to anyone with the `obra` module OR any `obra.*` permiso. */
export const obraGuard: CanActivateFn = () => {
  const ctx = inject(UserContextService);
  const router = inject(Router);
  return ctx.puedeVerObra() ? true : router.createUrlTree(['/403']);
};

/**
 * AY4c — gestión de proyectos (crear/editar la obra). El Ingeniero de Oficina VE la
 * ficha + costos (submoduleGuard proyectos.obras) pero NO gestiona → este guard lo
 * bloquea de /nuevo y /:id/editar. Espejo de `sgc.puede_gestionar_proyectos()`.
 */
export const proyectosGestionGuard: CanActivateFn = () => {
  const ctx = inject(UserContextService);
  const router = inject(Router);
  return ctx.puedeGestionarProyectos() ? true : router.createUrlTree(['/403']);
};
