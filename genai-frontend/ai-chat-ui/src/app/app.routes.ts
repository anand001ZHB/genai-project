import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard';
import { AuthPageComponent } from './auth-page/auth-page';
import { Chat } from './chat/chat';
import { authGuard } from './core/auth.guard';
import { roleGuard } from './core/role.guard';
import { HomeComponent } from './home/home';
import { PasswordPageComponent } from './password-page/password-page';
import { UserDashboardComponent } from './user-dashboard/user-dashboard';

export const routes: Routes = [
	{
		path: '',
		component: HomeComponent,
	},
	{
		path: 'auth',
		component: AuthPageComponent,
	},
	{
		path: 'password',
		component: PasswordPageComponent,
	},
	{
		path: 'user/dashboard',
		component: UserDashboardComponent,
		canActivate: [authGuard, roleGuard],
		data: { roles: ['user'] },
	},
	{
		path: 'admin/dashboard',
		component: AdminDashboardComponent,
		canActivate: [authGuard, roleGuard],
		data: { roles: ['admin'] },
	},
	{
		path: 'interview',
		component: Chat,
		canActivate: [authGuard],
	},
	{
		path: '**',
		redirectTo: '',
	},
];
