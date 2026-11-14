import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';
import { HouseService } from '../setup/house.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};

/** Tant que l'assistant de première configuration n'est pas terminé, on y renvoie l'utilisateur. */
export const setupGuard: CanActivateFn = () => {
  const house = inject(HouseService);
  const router = inject(Router);
  if (house.completed() === true) return true;
  if (house.completed() === false) return router.createUrlTree(['/setup']);
  return house.load().pipe(
    map(h => h.setup_completed ? true : router.createUrlTree(['/setup'])),
    catchError(() => of(true)),   // serveur injoignable : les pages affichent leurs propres erreurs
  );
};
