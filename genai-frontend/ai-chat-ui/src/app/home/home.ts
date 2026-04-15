import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent implements OnInit {
  constructor(
    private readonly router: Router,
    private readonly analyticsService: AnalyticsService,
    protected readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.analyticsService.track({ eventType: 'home_view', path: '/' }).subscribe();
  }

  async openAuth(trigger: 'header_login' | 'header_signup' | 'hero_start') {
    this.analyticsService.track({
      eventType: trigger,
      path: '/',
      status: 'clicked',
    }).subscribe();

    const mode = trigger === 'header_signup' ? 'signup' : 'login';
    await this.router.navigate(['/auth'], {
      queryParams: { mode },
    });
  }

  async goToRoleHome() {
    const roleHome = this.authService.landingRouteForRole(this.authService.getRole());
    await this.router.navigate([roleHome]);
  }

  async logout() {
    this.authService.logout();
    await this.router.navigate(['/']);
  }
}
