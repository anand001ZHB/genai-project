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

  it('captures section scores for substantive answers and includes them in the summary', async () => {
    jest.spyOn(service, 'getAIResponse').mockResolvedValue({
      rawText: '{"feedback":"Good explanation.","decision":"FOLLOW_UP","nextQuestion":"Can you give an example?","scores":{"theory":8,"coding":7,"scenario":8,"output":7}}',
      feedback: 'Good explanation.',
      decision: 'FOLLOW_UP',
      nextQuestion: 'Can you give an example?',
      isStructured: true,
      scores: {
        theory: 8,
        coding: 7,
        scenario: 8,
        output: 7,
      },
    } as any);

    service['sessions'].set('session-3', {
      id: 'session-3',
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
      sessionId: 'session-3',
      answer: 'A closure happens when an inner function keeps access to the outer function scope even after the outer function returns.',
    });

    expect(result.summary.hasScoreData).toBe(true);
    expect(result.summary.entries).toBe(1);
    expect(result.summary.theoryAvg).toBe(8);
    expect((result.summary as any).theoryCount).toBe(1);
    expect(result.summary.codingAvg).toBe(0);
  });

  it('answers short term clarification questions instead of saying it could not understand', async () => {
    service['sessions'].set('session-4', {
      id: 'session-4',
      config: {
        level: 'easy',
        experience: '0-1 years',
        topic: 'JavaScript',
        selfRating: 5,
      },
      lastQuestion: "What's the JavaScript statement to print a line with 'Hello, JavaScript!' inside?",
      stuckAttemptsForCurrentQuestion: 0,
      greetingAttemptsForCurrentQuestion: 0,
      redirectAttemptsForCurrentQuestion: 0,
      scoreTotals: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreCounts: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreEntries: 0,
      history: [{ role: 'interviewer', content: "What's the JavaScript statement to print a line with 'Hello, JavaScript!' inside?" }],
    } as any);

    const result = await service.evaluateAnswer({
      sessionId: 'session-4',
      answer: 'inside means ?',
    });

    expect(result.progress.responseSignal).toBe('clarification');
    expect(result.message.toLowerCase()).toContain('inside');
    expect(result.message.toLowerCase()).not.toContain('could not fully understand');
  });

  it('shows scores only for the category of the asked question', async () => {
    jest.spyOn(service, 'getAIResponse').mockResolvedValue({
      rawText: '{"feedback":"Nice.","decision":"FOLLOW_UP","nextQuestion":"Can you give a small example?","scores":{"theory":8,"coding":4,"scenario":3,"output":2}}',
      feedback: 'Nice.',
      decision: 'FOLLOW_UP',
      nextQuestion: 'Can you give a small example?',
      isStructured: true,
      scores: {
        theory: 8,
        coding: 4,
        scenario: 3,
        output: 2,
      },
    } as any);

    service['sessions'].set('session-5', {
      id: 'session-5',
      config: {
        level: 'easy',
        experience: '0-1 years',
        topic: 'JavaScript',
        selfRating: 5,
      },
      lastQuestion: 'What is hoisting in JavaScript?',
      stuckAttemptsForCurrentQuestion: 0,
      greetingAttemptsForCurrentQuestion: 0,
      redirectAttemptsForCurrentQuestion: 0,
      scoreTotals: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreCounts: {
        theory: 0,
        coding: 0,
        scenario: 0,
        output: 0,
      },
      scoreEntries: 0,
      history: [{ role: 'interviewer', content: 'What is hoisting in JavaScript?' }],
    } as any);

    const result = await service.evaluateAnswer({
      sessionId: 'session-5',
      answer: 'Hoisting is when variable and function declarations are processed before the code execution continues.',
    });

    expect(result.summary.hasScoreData).toBe(true);
    expect((result.summary as any).theoryCount).toBe(1);
    expect((result.summary as any).codingCount).toBe(0);
    expect(result.summary.theoryAvg).toBe(8);
    expect(result.summary.codingAvg).toBe(0);
  });
});
