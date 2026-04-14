import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {

  constructor(private chatService: ChatService) {}

  @Post('start')
  startInterview(
    @Body('level') level: string,
    @Body('topic') topic: string,
  ): Promise<any> {
    return this.chatService.startInterview({ level, topic });
  }

  @Post('answer')
  answerInterview(
    @Body('sessionId') sessionId: string,
    @Body('answer') answer: string,
  ): Promise<any> {
    return this.chatService.evaluateAnswer({ sessionId, answer, question: '' });
  }

  @Post('end')
  endInterview(
    @Body('sessionId') sessionId: string,
  ): Promise<any> {
    return this.chatService.endInterview(sessionId);
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