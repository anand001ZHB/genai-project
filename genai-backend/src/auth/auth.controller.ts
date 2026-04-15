import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(
    @Body() dto: SignupDto,
    @Req() request: Request,
    @Headers('x-visitor-id') visitorId?: string,
  ) {
    return this.authService.signup(dto, request, visitorId);
  }

  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Headers('x-visitor-id') visitorId?: string,
  ) {
    return this.authService.login(dto, request, visitorId);
  }

  @Post('forgot-password')
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
    @Headers('x-visitor-id') visitorId?: string,
  ) {
    return this.authService.forgotPassword(dto, request, visitorId);
  }

  @Post('reset-password')
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Headers('x-visitor-id') visitorId?: string,
  ) {
    return this.authService.resetPassword(dto, request, visitorId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.authService.changePassword(user, dto, request);
  }
}
