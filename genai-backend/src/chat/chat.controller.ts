import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from '../analytics/analytics.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {

  constructor(
    private chatService: ChatService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post('start')
  async startInterview(
    @Body('level') level: string,
    @Body('topic') topic: string,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<any> {
    const result = await this.chatService.startInterview({ level, topic });
    await this.analyticsService.logEvent({
      eventType: 'interview_started',
      request,
      path: '/interview',
      user,
      status: 'success',
      metadata: { level, topic },
    });
    return result;
  }

  @Post('answer')
  answerInterview(
    @Body('sessionId') sessionId: string,
    @Body('answer') answer: string,
  ): Promise<any> {
    return this.chatService.evaluateAnswer({ sessionId, answer, question: '' });
  }

  @Post('end')
  async endInterview(
    @Body('sessionId') sessionId: string,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<any> {
    const result = await this.chatService.endInterview(sessionId);
    await this.analyticsService.logEvent({
      eventType: 'interview_ended',
      request,
      path: '/interview',
      user,
      status: 'success',
      metadata: { sessionId },
    });
    return result;
  }

  @Post('casual')
  casualChat(@Body('message') message: string): Promise<any> {
    return this.chatService.casualChat(message);
  }

  @Post()
  chat(@Body('message') message: string): Promise<any> {
    return this.chatService.getAIResponse(message);
  }
}