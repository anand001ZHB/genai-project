export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
