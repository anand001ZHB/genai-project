import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/analytics-event.schema';

interface LogEventInput {
  eventType: string;
  path?: string;
  visitorId?: string;
  request?: Request;
  user?: JwtPayload | { id: string; name: string; email: string; role: UserRole };
  email?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(AnalyticsEvent.name) private readonly analyticsModel: Model<AnalyticsEventDocument>,
    private readonly usersService: UsersService,
  ) {}

  async logEvent(input: LogEventInput): Promise<void> {
    const ipAddress = this.extractIpAddress(input.request);
    const userAgent = input.request?.headers['user-agent'] || undefined;
    const userId = input.user ? ('sub' in input.user ? input.user.sub : input.user.id) : undefined;
    const userName = input.user?.name;
    const userEmail = input.user?.email || input.email;
    const role = input.user?.role;

    await this.analyticsModel.create({
      eventType: input.eventType,
      path: input.path,
      visitorId: input.visitorId,
      ipAddress,
      userAgent,
      userId,
      userName,
      userEmail,
      role,
      status: input.status,
      metadata: input.metadata,
    });
  }

  async getOverview() {
    const [
      totalUsers,
      roleCounts,
      totalEvents,
      totalLogins,
      totalSignups,
      interviewStarts,
      uniqueVisitorsResult,
      eventsByType,
      topRoutes,
      recentEvents,
      dailyVisitors,
    ] = await Promise.all([
      this.usersService.countUsers(),
      this.usersService.getRoleCounts(),
      this.analyticsModel.countDocuments().exec(),
      this.analyticsModel.countDocuments({ eventType: 'login_success' }).exec(),
      this.analyticsModel.countDocuments({ eventType: 'signup_success' }).exec(),
      this.analyticsModel.countDocuments({ eventType: 'interview_started' }).exec(),
      this.analyticsModel.aggregate([
        { $match: { visitorId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$visitorId' } },
        { $count: 'count' },
      ]),
      this.analyticsModel.aggregate([
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.analyticsModel.aggregate([
        { $match: { path: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),
      this.analyticsModel
        .find({}, { eventType: 1, userName: 1, userEmail: 1, role: 1, path: 1, visitorId: 1, status: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .limit(15)
        .lean()
        .exec(),
      this.analyticsModel.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
            },
            visitorId: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              visitorId: '$visitorId',
            },
          },
        },
        { $group: { _id: '$_id.date', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      totals: {
        totalUsers,
        adminUsers: roleCounts[UserRole.ADMIN],
        standardUsers: roleCounts[UserRole.USER],
        totalEvents,
        uniqueVisitors: uniqueVisitorsResult[0]?.count || 0,
        totalLogins,
        totalSignups,
        interviewStarts,
      },
      eventsByType: eventsByType.map((item) => ({ eventType: item._id, count: item.count })),
      topRoutes: topRoutes.map((item) => ({ path: item._id, count: item.count })),
      dailyVisitors: dailyVisitors.map((item) => ({ date: item._id, count: item.count })),
      recentEvents,
    };
  }

  private extractIpAddress(request?: Request): string | undefined {
    if (!request) {
      return undefined;
    }

    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0]?.trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor[0]) {
      return forwardedFor[0];
    }

    return request.ip;
  }
}
