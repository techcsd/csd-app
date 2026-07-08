import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { PinService } from '../services/pin.service';

/**
 * After auth, the app must be unlocked with the local PIN for this launch.
 * If no PIN is set yet → setup; if set but not yet entered → unlock.
 */
export const pinGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const pin = inject(PinService);
  const router = inject(Router);

  if (session.unlocked()) return true;

  if (await pin.isSet()) {
    return router.createUrlTree(['/auth/pin']);
  }
  return router.createUrlTree(['/auth/pin-setup']);
};
