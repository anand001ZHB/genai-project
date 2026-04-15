import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  const baseRequest = request.clone({
    withCredentials: true,
  });

  if (!token) {
    return next(baseRequest);
  }

  return next(
    baseRequest.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    }),
  );
};
