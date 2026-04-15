import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';

@Component({
  selector: 'app-user-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './user-dashboard.html',
  styleUrl: './user-dashboard.css',
})
export class UserDashboardComponent implements OnInit {
  constructor(
    private readonly router: Router,
    protected readonly authService: AuthService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  ngOnInit(): void {
    this.analyticsService.track({ eventType: 'user_dashboard_view', path: '/user/dashboard' }).subscribe();
  }

  async startInterview() {
    this.analyticsService.track({ eventType: 'user_start_interview_click', path: '/user/dashboard', status: 'clicked' }).subscribe();
    await this.router.navigate(['/interview']);
  }

  async logout() {
    this.authService.logout();
    await this.router.navigate(['/']);
  }
}
