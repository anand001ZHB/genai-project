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
  ) {
    return this.chatService.startInterview({ level, experience, topic, selfRating });
  }

  @Post('answer')
  answerInterview(
    @Body('answer') answer: string,
    @Body('question') question: string,
    @Body('level') level: string,
    @Body('experience') experience: string,
    @Body('topic') topic: string,
    @Body('stuckAttempts') stuckAttempts: number,
    @Body('responseSignal') responseSignal: 'normal' | 'dont_know' | 'move_on' | 'greeting',
  ) {
    return this.chatService.evaluateAnswer({ answer, question, level, experience, topic, stuckAttempts, responseSignal });
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