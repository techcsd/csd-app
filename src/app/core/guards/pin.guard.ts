import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { DeepLinkService } from '../services/deep-link.service';
import { PinService } from '../services/pin.service';

/**
 * After auth, the app must be unlocked with the local PIN for this launch.
 * If no PIN is set yet → setup; if set but not yet entered → unlock.
 */
export const pinGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionService);
  const pin = inject(PinService);
  const router = inject(Router);
  const deepLink = inject(DeepLinkService);

  if (session.unlocked()) return true;

  deepLink.guardar(state.url); // DS-52 — el destino se retoma al desbloquear
  if (await pin.isSet()) {
    return router.createUrlTree(['/auth/pin']);
  }
  return router.createUrlTree(['/auth/pin-setup']);
};
