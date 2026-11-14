import { HttpInterceptorFn, HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { catchError, switchMap, throwError } from 'rxjs';

/** Routes d'authentification publiques : seules à ne pas porter le jeton (refresh et sse-ticket, eux, en ont besoin). */
const PUBLIC_AUTH = /\/api\/auth\/(login|status|setup)/;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const http = inject(HttpClient);
  const token = auth.getToken();

  if (token && !PUBLIC_AUTH.test(req.url)) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(req).pipe(
    catchError((err) => {
      if (err.status === 401 && token && !PUBLIC_AUTH.test(req.url) && !req.url.includes('/api/auth/refresh')) {
        return http.post<{ token: string }>('/api/auth/refresh', {}).pipe(
          switchMap((res) => {
            auth.storeToken(res.token);
            return next(req.clone({ setHeaders: { Authorization: `Bearer ${res.token}` } }));
          }),
          catchError((refreshErr) => {
            auth.logout();
            return throwError(() => refreshErr);
          })
        );
      }
      return throwError(() => err);
    })
  );
};
