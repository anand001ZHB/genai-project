import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { resolveApiBaseUrl } from '../shared/api-base-url';
import { AnalyticsService } from '../core/analytics.service';
import { AuthResponse, AuthUser, UserRole } from './auth.models';

interface SignupPayload {
  name: string;
  email: string;
  password: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

interface ForgotPasswordPayload {
  email: string;
}

interface ResetForgotPasswordPayload {
  token: string;
  newPassword: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiBaseUrl = resolveApiBaseUrl();
  private readonly tokenStorageKey = 'genai.auth.token';
  private readonly userStorageKey = 'genai.auth.user';

  readonly currentUser = signal<AuthUser | null>(this.readStoredUser());
  readonly accessToken = signal<string | null>(this.readStoredToken());

  constructor(
    private readonly http: HttpClient,
    private readonly analyticsService: AnalyticsService,
  ) {}

  isAuthenticated(): boolean {
    return !!this.accessToken();
  }

  getRole(): UserRole | null {
    return this.currentUser()?.role || null;
  }

  getToken(): string | null {
    return this.accessToken();
  }

  async signup(payload: SignupPayload): Promise<AuthResponse> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(this.buildUrl('/auth/signup'), payload, {
        headers: {
          'x-visitor-id': this.analyticsService.getVisitorId(),
        },
      }),
    );

    this.persistAuth(response);
    return response;
  }

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(this.buildUrl('/auth/login'), payload, {
        headers: {
          'x-visitor-id': this.analyticsService.getVisitorId(),
        },
      }),
    );

    this.persistAuth(response);
    return response;
  }

  async refreshProfile(): Promise<AuthUser | null> {
    if (!this.getToken()) {
      return null;
    }

    const user = await firstValueFrom(this.http.get<AuthUser>(this.buildUrl('/auth/me')));
    this.currentUser.set(user);
    localStorage.setItem(this.userStorageKey, JSON.stringify(user));
    return user;
  }

  async changePassword(payload: ChangePasswordPayload): Promise<void> {
    await firstValueFrom(this.http.post<{ ok: true }>(this.buildUrl('/auth/change-password'), payload));
  }

  async forgotPassword(payload: ForgotPasswordPayload): Promise<{ ok: true; message: string; resetToken?: string }> {
    return firstValueFrom(this.http.post<{ ok: true; message: string; resetToken?: string }>(this.buildUrl('/auth/forgot-password'), payload, {
      headers: {
        'x-visitor-id': this.analyticsService.getVisitorId(),
      },
    }));
  }

  async resetForgottenPassword(payload: ResetForgotPasswordPayload): Promise<{ ok: true; message: string }> {
    return firstValueFrom(this.http.post<{ ok: true; message: string }>(this.buildUrl('/auth/reset-password'), payload, {
      headers: {
        'x-visitor-id': this.analyticsService.getVisitorId(),
      },
    }));
  }

  logout(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(this.tokenStorageKey);
    localStorage.removeItem(this.userStorageKey);
  }

  landingRouteForRole(role: UserRole | null | undefined): string {
    return role === 'admin' ? '/admin/dashboard' : '/user/dashboard';
  }

  private persistAuth(response: AuthResponse): void {
    this.accessToken.set(response.accessToken);
    this.currentUser.set(response.user);
    localStorage.setItem(this.tokenStorageKey, response.accessToken);
    localStorage.setItem(this.userStorageKey, JSON.stringify(response.user));
  }

  private readStoredToken(): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    return localStorage.getItem(this.tokenStorageKey);
  }

  private readStoredUser(): AuthUser | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const rawUser = localStorage.getItem(this.userStorageKey);
    if (!rawUser) {
      return null;
    }

    try {
      return JSON.parse(rawUser) as AuthUser;
    } catch {
      return null;
    }
  }

  private buildUrl(path: string): string {
    return this.apiBaseUrl ? `${this.apiBaseUrl}${path}` : path;
  }
}
