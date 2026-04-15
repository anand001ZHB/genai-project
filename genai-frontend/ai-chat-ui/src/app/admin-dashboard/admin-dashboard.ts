import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AuthUser, UserRole } from '../auth/auth.models';
import { resolveApiBaseUrl } from '../shared/api-base-url';

interface AnalyticsOverview {
  totals: {
    totalUsers: number;
    adminUsers: number;
    standardUsers: number;
    totalEvents: number;
    uniqueVisitors: number;
    totalLogins: number;
    totalSignups: number;
    interviewStarts: number;
  };
  eventsByType: Array<{ eventType: string; count: number }>;
  topRoutes: Array<{ path: string; count: number }>;
  dailyVisitors: Array<{ date: string; count: number }>;
  recentEvents: Array<{
    _id: string;
    eventType: string;
    userName?: string;
    userEmail?: string;
    role?: string;
    path?: string;
    visitorId?: string;
    status?: string;
    createdAt: string;
  }>;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboardComponent implements OnInit {
  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly users = signal<AuthUser[]>([]);
  readonly isLoading = signal(true);
  readonly isUsersLoading = signal(true);
  readonly isSubmittingUser = signal(false);
  readonly roleUpdateUserId = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly usersErrorMessage = signal('');
  private readonly apiBaseUrl = resolveApiBaseUrl();
  roleDrafts: Record<string, UserRole> = {};

  newUserForm: { name: string; email: string; password: string; role: UserRole } = {
    name: '',
    email: '',
    password: '',
    role: 'user',
  };

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
    protected readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    void Promise.all([this.loadOverview(), this.loadUsers()]);
  }

  async loadOverview() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const response = await firstValueFrom(this.http.get<AnalyticsOverview>(this.buildUrl('/analytics/overview')));
      this.overview.set(response);
    } catch (error: any) {
      this.errorMessage.set(error?.error?.message || 'Unable to load analytics right now.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadUsers() {
    this.isUsersLoading.set(true);
    this.usersErrorMessage.set('');

    try {
      const response = await firstValueFrom(this.http.get<AuthUser[]>(this.buildUrl('/users')));
      this.users.set(response);
      this.roleDrafts = Object.fromEntries(response.map((user) => [user.id, user.role]));
    } catch (error) {
      this.usersErrorMessage.set(this.extractErrorMessage(error, 'Unable to load users right now.'));
    } finally {
      this.isUsersLoading.set(false);
    }
  }

  async createUser() {
    this.isSubmittingUser.set(true);
    this.usersErrorMessage.set('');

    try {
      await firstValueFrom(this.http.post<AuthUser>(this.buildUrl('/users'), this.newUserForm));
      this.newUserForm = {
        name: '',
        email: '',
        password: '',
        role: 'user',
      };
      await Promise.all([this.loadUsers(), this.loadOverview()]);
    } catch (error) {
      this.usersErrorMessage.set(this.extractErrorMessage(error, 'Unable to create the user right now.'));
    } finally {
      this.isSubmittingUser.set(false);
    }
  }

  async deleteUser(userId: string) {
    this.usersErrorMessage.set('');

    try {
      await firstValueFrom(this.http.delete<{ ok: true }>(this.buildUrl(`/users/${userId}`)));
      await Promise.all([this.loadUsers(), this.loadOverview()]);
    } catch (error) {
      this.usersErrorMessage.set(this.extractErrorMessage(error, 'Unable to remove the user right now.'));
    }
  }

  async updateUserRole(userId: string) {
    this.usersErrorMessage.set('');
    this.roleUpdateUserId.set(userId);

    try {
      await firstValueFrom(this.http.patch<AuthUser>(this.buildUrl(`/users/${userId}/role`), {
        role: this.roleDrafts[userId],
      }));
      await Promise.all([this.loadUsers(), this.loadOverview()]);
    } catch (error) {
      this.usersErrorMessage.set(this.extractErrorMessage(error, 'Unable to update the user role right now.'));
    } finally {
      this.roleUpdateUserId.set(null);
    }
  }

  async logout() {
    this.authService.logout();
    await this.router.navigate(['/']);
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Cannot reach the server right now. Check that the backend API is running and the backend port is reachable.';
      }

      const serverMessage = error.error?.message;

      if (Array.isArray(serverMessage) && serverMessage.length > 0) {
        return serverMessage.join(', ');
      }

      if (typeof serverMessage === 'string' && serverMessage.trim().length > 0) {
        return serverMessage;
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

  private buildUrl(path: string): string {
    return this.apiBaseUrl ? `${this.apiBaseUrl}${path}` : path;
  }
}
