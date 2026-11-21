import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { BankService } from './bank.service';

/** Pages that need a logged-in user: check the session, otherwise go to /login. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const bank = inject(BankService);
  const router = inject(Router);
  return (await bank.checkSession())
    ? true
    : router.createUrlTree(['/login'], { queryParams: state.url && state.url !== '/' ? { next: state.url } : {} });
};

/** The login page itself: skip it when already logged in. */
export const guestGuard: CanActivateFn = async () => {
  const bank = inject(BankService);
  return (await bank.checkSession()) ? inject(Router).createUrlTree(['/']) : true;
};

/** Any 401 from the API (e.g. session expired) sends the user back to the login page. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const bank = inject(BankService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthCall = req.url.startsWith('/api/auth/');
      if (err.status === 401 && !isAuthCall && bank.session() === 'in') {
        bank.reset();
        router.navigate(['/login'], { queryParams: { expired: 1 } });
      }
      return throwError(() => err);
    }),
  );
};
