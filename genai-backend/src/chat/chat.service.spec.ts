import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatService],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('recovers structured replies even when the model returns almost-valid JSON', async () => {
    jest.spyOn(service as any, 'getOpenAIClient').mockReturnValue({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: '```json\n{"feedback":"Sure.","decision":"NEXT","nextQuestion":"What is a closure?",}\n```',
                },
              },
            ],
          }),
        },
      },
    });

    const result = await service.getAIResponse('test prompt');

    expect(result.isStructured).toBe(true);
    expect(result.feedback).toBe('Sure.');
    expect(result.decision).toBe('NEXT');
    expect(result.nextQuestion).toBe('What is a closure?');
  });

  it('treats clarification phrases as a request to repeat the question', async () => {
    service['sessions'].set('session-1', {
      id: 'session-1',
      config: {
        level: 'easy',
        experience: '0-1 years',
        topic: 'JavaScript',
        selfRating: 5,
      },
      lastQuestion: 'What is a closure?',
      stuckAttemptsForCurrentQuestion: 0,
      greetingAttemptsForCurrentQuestion: 0,
      redirectAttemptsForCurrentQuestion: 0,
      scoreTotals: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreEntries: 0,
      history: [{ role: 'interviewer', content: 'What is a closure?' }],
    });

    const result = await service.evaluateAnswer({
      sessionId: 'session-1',
      answer: 'Can you repeat the question?',
    });

    expect(result.progress.responseSignal).toBe('clarification');
    expect(result.question).toBe('What is a closure?');
    expect(result.message.toLowerCase()).toContain('closure');
  });

  it('moves to a new question after a second typoed dont-know response', async () => {
    jest.spyOn(service, 'getAIResponse').mockResolvedValue({
      rawText: '{"feedback":"Fair enough.","decision":"NEXT","nextQuestion":"What is hoisting in JavaScript?"}',
      feedback: 'Fair enough.',
      decision: 'NEXT',
      nextQuestion: 'What is hoisting in JavaScript?',
      isStructured: true,
    } as any);

    service['sessions'].set('session-2', {
      id: 'session-2',
      config: {
        level: 'easy',
        experience: '0-1 years',
        topic: 'JavaScript',
        selfRating: 5,
      },
      lastQuestion: 'Can you explain the difference between let and const?',
      stuckAttemptsForCurrentQuestion: 1,
      greetingAttemptsForCurrentQuestion: 0,
      redirectAttemptsForCurrentQuestion: 0,
      scoreTotals: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreEntries: 0,
      history: [{ role: 'interviewer', content: 'Can you explain the difference between let and const?' }],
    });

    const result = await service.evaluateAnswer({
      sessionId: 'session-2',
      answer: 'i dont jnow',
    });

    expect(result.progress.responseSignal).toBe('dont_know');
    expect(result.progress.questionChanged).toBe(true);
    expect(result.question).toBe('What is hoisting in JavaScript?');
  });

  it('greets the user before asking the first interview question', async () => {
    jest.spyOn(service, 'getAIResponse').mockResolvedValue({
      rawText: '{"feedback":"Got it.","decision":"NEXT","nextQuestion":"What is a closure in JavaScript?"}',
      feedback: 'Got it.',
      decision: 'NEXT',
      nextQuestion: 'What is a closure in JavaScript?',
      isStructured: true,
    } as any);

    const result = await service.startInterview({
      level: 'easy',
      experience: '0-1 years',
      topic: 'JavaScript',
      selfRating: 5,
    });

    expect(result.message.startsWith('Welcome')).toBe(true);
    expect(result.message).toContain('What is a closure in JavaScript?');
    expect(result.message).not.toContain('Got it.');
  });

  it('does not duplicate the greeting when the first question already includes one', async () => {
    jest.spyOn(service, 'getAIResponse').mockResolvedValue({
      rawText: '{"feedback":"","decision":"NEXT","nextQuestion":"Good morning, let\'s get started. Can you explain closures in JavaScript?"}',
      feedback: '',
      decision: 'NEXT',
      nextQuestion: 'Good morning, let\'s get started. Can you explain closures in JavaScript?',
      isStructured: true,
    } as any);

    const result = await service.startInterview({
      level: 'easy',
      experience: '0-1 years',
      topic: 'JavaScript',
      selfRating: 5,
    });

    expect(result.message).toBe('Good morning, let\'s get started. Can you explain closures in JavaScript?');
  });
});
