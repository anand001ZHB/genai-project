import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../auth/auth.models';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const requiredRoles = (route.data['roles'] as UserRole[] | undefined) || [];
  const currentRole = authService.getRole();

  if (!currentRole) {
    return router.createUrlTree(['/auth']);
  }

  if (requiredRoles.length === 0 || requiredRoles.includes(currentRole)) {
    return true;
  }

  return router.createUrlTree([authService.landingRouteForRole(currentRole)]);
};
