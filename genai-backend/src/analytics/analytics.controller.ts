import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto } from './dto/track-event.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  async trackEvent(
    @Body() dto: TrackEventDto,
    @Req() request: Request,
    @Headers('x-visitor-id') visitorIdHeader?: string,
  ) {
    await this.analyticsService.logEvent({
      eventType: dto.eventType,
      path: dto.path,
      visitorId: dto.visitorId || visitorIdHeader,
      request,
      status: dto.status,
      metadata: dto.metadata,
    });

    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('overview')
  async getOverview(@CurrentUser() user: JwtPayload, @Req() request: Request) {
    await this.analyticsService.logEvent({
      eventType: 'admin_dashboard_view',
      path: '/admin/dashboard',
      request,
      user,
      status: 'success',
    });

    return this.analyticsService.getOverview();
  }
}
