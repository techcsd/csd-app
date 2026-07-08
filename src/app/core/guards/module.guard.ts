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
