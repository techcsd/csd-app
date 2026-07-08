import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { UserContextService } from '../services/user-context.service';

/** Requires a persistent Supabase session + an active user; otherwise → login. */
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const ctx = inject(UserContextService);
  const router = inject(Router);

  if (!(await session.hasSession())) {
    return router.createUrlTree(['/auth/login']);
  }
  await session.ensureProfile();
  // A user deactivated in SGC can't use the app (PERM-02). activo comes from
  // the just-loaded profile; false → force logout.
  if (ctx.profile()?.activo === false) {
    await session.logout();
    return router.createUrlTree(['/auth/login']);
  }
  return true;
};
