import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

type PasswordMode = 'forgot' | 'change';

@Component({
  selector: 'app-password-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './password-page.html',
  styleUrl: './password-page.css',
})
export class PasswordPageComponent implements OnInit {
  readonly mode = signal<PasswordMode>('forgot');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly devResetToken = signal('');
  readonly isSubmitting = signal(false);

  forgotForm = {
    email: '',
  };

  resetForm = {
    token: '',
    newPassword: '',
    confirmPassword: '',
  };

  changeForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  };

  constructor(
    protected readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const requestedMode = this.route.snapshot.queryParamMap.get('mode');
    if (requestedMode === 'change' && this.authService.isAuthenticated()) {
      this.mode.set('change');
    }

    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.forgotForm.email = email;
    }
  }

  async setMode(nextMode: PasswordMode) {
    if (nextMode === 'change' && !this.authService.isAuthenticated()) {
      await this.router.navigate(['/auth'], { queryParams: { redirectTo: '/password?mode=change' } });
      return;
    }

    this.mode.set(nextMode);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.devResetToken.set('');
  }

  async requestForgotPassword() {
    const email = this.forgotForm.email.trim();
    if (!this.isValidEmail(email)) {
      this.errorMessage.set('Enter a valid email address.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.devResetToken.set('');

    try {
      const response = await this.authService.forgotPassword({ email });
      this.successMessage.set(response.message);
      this.forgotForm.email = email;
      if (response.resetToken) {
        this.devResetToken.set(response.resetToken);
        this.resetForm.token = response.resetToken;
      }
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Unable to request a password reset right now.'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async resetForgottenPassword() {
    if (!this.resetForm.token.trim()) {
      this.errorMessage.set('Reset token is required.');
      return;
    }

    if (this.resetForm.newPassword.length < 6) {
      this.errorMessage.set('New password must be at least 6 characters.');
      return;
    }

    if (this.resetForm.newPassword !== this.resetForm.confirmPassword) {
      this.errorMessage.set('New password and confirmation do not match.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const response = await this.authService.resetForgottenPassword({
        token: this.resetForm.token.trim(),
        newPassword: this.resetForm.newPassword,
      });
      this.successMessage.set(response.message);
      this.resetForm = { token: '', newPassword: '', confirmPassword: '' };
      this.devResetToken.set('');
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Unable to reset the password right now.'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async changePassword() {
    if (this.changeForm.newPassword.length < 6) {
      this.errorMessage.set('New password must be at least 6 characters.');
      return;
    }

    if (this.changeForm.newPassword !== this.changeForm.confirmPassword) {
      this.errorMessage.set('New password and confirmation do not match.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      await this.authService.changePassword({
        currentPassword: this.changeForm.currentPassword,
        newPassword: this.changeForm.newPassword,
      });
      this.successMessage.set('Password updated successfully.');
      this.changeForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    } catch (error) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Unable to change the password right now.'));
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
    }

    return fallback;
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}