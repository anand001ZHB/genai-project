import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AnalyticsService } from '../analytics/analytics.service';
import { UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.usersService.ensureAdminUser();
  }

  async signup(dto: SignupDto, request: Request, visitorId?: string) {
    const user = await this.usersService.createUser({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: UserRole.USER,
    });

    const authResponse = await this.buildAuthResponse(user.id);

    await this.analyticsService.logEvent({
      eventType: 'signup_success',
      request,
      visitorId,
      path: '/auth/signup',
      user: authResponse.user,
      status: 'success',
    });

    return authResponse;
  }

  async login(dto: LoginDto, request: Request, visitorId?: string) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !(await this.usersService.validatePassword(user, dto.password))) {
      await this.analyticsService.logEvent({
        eventType: 'login_attempt',
        request,
        visitorId,
        path: '/auth/login',
        status: 'failed',
        email: dto.email.trim().toLowerCase(),
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.usersService.touchLastLogin(user.id);
    const authResponse = await this.buildAuthResponse(user.id);

    await this.analyticsService.logEvent({
      eventType: 'login_success',
      request,
      visitorId,
      path: '/auth/login',
      user: authResponse.user,
      status: 'success',
    });

    return authResponse;
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findByIdOrThrow(userId);
    return this.toSafeUser(user);
  }

  async forgotPassword(dto: ForgotPasswordDto, request: Request, visitorId?: string) {
    const resetToken = await this.usersService.createPasswordResetToken(dto.email.trim().toLowerCase());

    await this.analyticsService.logEvent({
      eventType: 'forgot_password_requested',
      request,
      visitorId,
      path: '/auth/forgot-password',
      status: resetToken ? 'success' : 'ignored',
      email: dto.email.trim().toLowerCase(),
    });

    const response: { ok: true; message: string; resetToken?: string } = {
      ok: true,
      message: 'If an account exists for that email, a password reset token has been issued.',
    };

    if (resetToken && process.env.NODE_ENV !== 'production') {
      response.resetToken = resetToken;
    }

    return response;
  }

  async resetPassword(dto: ResetPasswordDto, request: Request, visitorId?: string) {
    const user = await this.usersService.resetPasswordWithToken(dto.token, dto.newPassword);

    await this.analyticsService.logEvent({
      eventType: 'forgot_password_completed',
      request,
      visitorId,
      path: '/auth/reset-password',
      status: 'success',
      user: this.toSafeUser(user),
    });

    return { ok: true, message: 'Password has been reset successfully.' };
  }

  async changePassword(user: JwtPayload, dto: ChangePasswordDto, request: Request) {
    await this.usersService.changeUserPassword(user.sub, dto.currentPassword, dto.newPassword);

    await this.analyticsService.logEvent({
      eventType: 'password_change_success',
      request,
      path: '/auth/change-password',
      user,
      status: 'success',
    });

    return { ok: true };
  }

  private async buildAuthResponse(userId: string) {
    const user = await this.usersService.findByIdOrThrow(userId);
    const safeUser = this.toSafeUser(user);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: safeUser,
    };
  }

  private toSafeUser(user: { id: string; name: string; email: string; role: UserRole; lastLoginAt?: Date | null; createdAt?: Date | null }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      lastLoginAt: user.lastLoginAt || null,
      createdAt: user.createdAt || null,
    };
  }
}
