import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';

/** Requires a persistent Supabase session; otherwise → login. */
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (await session.hasSession()) {
    await session.ensureProfile();
    return true;
  }
  return router.createUrlTree(['/auth/login']);
};
