import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {

  constructor(private chatService: ChatService) {}

  @Post('start')
  startInterview(
    @Body('level') level: string,
    @Body('experience') experience: string,
    @Body('topic') topic: string,
    @Body('selfRating') selfRating: number,
  ): Promise<any> {
    return this.chatService.startInterview({ level, experience, topic, selfRating });
  }

  @Post('answer')
  answerInterview(
    @Body('sessionId') sessionId: string,
    @Body('answer') answer: string,
  ): Promise<any> {
    return this.chatService.evaluateAnswer({ sessionId, answer, question: '' });
  }

  @Post('casual')
  casualChat(@Body('message') message: string) {
    return this.chatService.casualChat(message);
  }

  @Post()
  chat(@Body('message') message: string) {
    return this.chatService.getAIResponse(message);
  }
}