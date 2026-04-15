import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
})
export class AuthPageComponent implements OnInit {
  readonly mode = signal<'login' | 'signup'>('login');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  loginForm = {
    email: '',
    password: '',
  };

  signupForm = {
    name: '',
    email: '',
    password: '',
  };

  private redirectTo = '';

  constructor(
    private readonly authService: AuthService,
    private readonly analyticsService: AnalyticsService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      void this.router.navigate([this.authService.landingRouteForRole(this.authService.getRole())]);
      return;
    }

    this.redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '';
    const requestedMode = this.route.snapshot.queryParamMap.get('mode');
    if (requestedMode === 'signup' || requestedMode === 'login') {
      this.mode.set(requestedMode);
    }
    this.analyticsService.track({ eventType: 'auth_page_view', path: '/auth' }).subscribe();
  }

  setMode(nextMode: 'login' | 'signup') {
    this.mode.set(nextMode);
    this.errorMessage.set('');
  }

  async submitLogin() {
    const loginValidationMessage = this.validateLoginForm();
    if (loginValidationMessage) {
      this.errorMessage.set(loginValidationMessage);
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      const response = await this.authService.login(this.loginForm);
      await this.router.navigate([this.redirectTarget(response.user.role)]);
    } catch (error: any) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Unable to sign in right now.'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async submitSignup() {
    const signupValidationMessage = this.validateSignupForm();
    if (signupValidationMessage) {
      this.errorMessage.set(signupValidationMessage);
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      const response = await this.authService.signup(this.signupForm);
      await this.router.navigate([this.redirectTarget(response.user.role)]);
    } catch (error: any) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Unable to create the account right now.'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Cannot reach the server right now. Check that the backend API is running and that the forwarded backend port is accessible.';
      }

      const serverMessage = error.error?.message;

      if (Array.isArray(serverMessage) && serverMessage.length > 0) {
        return serverMessage.join(', ');
      }

      if (typeof serverMessage === 'string' && serverMessage.trim().length > 0) {
        return serverMessage;
      }

      if (typeof error.message === 'string' && error.message.trim().length > 0) {
        return error.message;
      }
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }

    return fallback;
  }

  private validateLoginForm(): string | null {
    const email = this.loginForm.email.trim();
    const password = this.loginForm.password;

    if (!email) {
      return 'Email is required.';
    }

    if (!this.isValidEmail(email)) {
      return 'Enter a valid email address.';
    }

    if (!password || password.length < 6) {
      return 'Password must be at least 6 characters.';
    }

    this.loginForm.email = email;
    return null;
  }

  private validateSignupForm(): string | null {
    const name = this.signupForm.name.trim();
    const email = this.signupForm.email.trim();
    const password = this.signupForm.password;

    if (!name) {
      return 'Name is required.';
    }

    if (name.length < 2) {
      return 'Name must be at least 2 characters.';
    }

    if (!email) {
      return 'Email is required.';
    }

    if (!this.isValidEmail(email)) {
      return 'Enter a valid email address.';
    }

    if (!password || password.length < 6) {
      return 'Password must be at least 6 characters.';
    }

    this.signupForm.name = name;
    this.signupForm.email = email;
    return null;
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private redirectTarget(role: 'admin' | 'user'): string {
    if (this.redirectTo && this.redirectTo.startsWith('/')) {
      return this.redirectTo;
    }

    return this.authService.landingRouteForRole(role);
  }
}
