import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

type ResponseSignal = 'normal' | 'dont_know' | 'move_on' | 'greeting' | 'end_interview';

interface InterviewConfig {
  level?: string;
  experience?: string;
  topic?: string;
  selfRating?: number;
}

interface AnswerPayload extends InterviewConfig {
  sessionId?: string;
  answer: string;
  question?: string;
  stuckAttempts?: number;
  responseSignal?: ResponseSignal;
}

interface SectionScores {
  theory: number;
  coding: number;
  scenario: number;
  output: number;
}

interface InterviewSession {
  id: string;
  config: Required<InterviewConfig>;
  lastQuestion: string;
  stuckAttemptsForCurrentQuestion: number;
  scoreTotals: SectionScores;
  scoreEntries: number;
}

@Injectable()
export class ChatService {

  private sessions = new Map<string, InterviewSession>();

  private createSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private createEmptyScores(): SectionScores {
    return {
      theory: 0,
      coding: 0,
      scenario: 0,
      output: 0,
    };
  }

  private roundScore(score: number): number {
    return Math.round(score * 10) / 10;
  }

  private isSubstantiveAnswer(answer: string): boolean {
    const normalized = (answer || '').trim();
    if (!normalized) return false;

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length >= 6;
  }

  private levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }

    return matrix[a.length][b.length];
  }

  private isApproxWord(token: string, target: string, maxDistance = 2): boolean {
    if (!token || !target) return false;
    if (token === target) return true;
    if (Math.abs(token.length - target.length) > maxDistance) return false;

    return this.levenshteinDistance(token, target) <= maxDistance;
  }

  private hasFuzzyEndInterviewIntent(cleaned: string): boolean {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    const endWords = ['end', 'stop', 'close', 'finish', 'quit', 'terminate'];
    const interviewWords = ['interview', 'session'];
    const overWords = ['over', 'done', 'ended', 'finished'];

    const hasEndWord = tokens.some((token) => endWords.some((word) => this.isApproxWord(token, word, 2)));
    const hasInterviewWord = tokens.some((token) => interviewWords.some((word) => this.isApproxWord(token, word, 2)));
    const hasOverWord = tokens.some((token) => overWords.some((word) => this.isApproxWord(token, word, 2)));

    return (hasEndWord && hasInterviewWord) || (hasInterviewWord && hasOverWord);
  }

  private hasUncertaintyCue(answer: string): boolean {
    const normalized = (answer || '')
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .trim();

    if (!normalized) return false;

    const cues = [
      "don't know",
      'dont know',
      'do not know',
      'not sure',
      'no idea',
      'no clue',
      'idk',
      "can't answer",
      'cannot answer',
      "don't remember",
      'cannot recall',
      'unsure',
      'uncertain',
      'unable to answer',
      'not able to answer',
    ];

    if (cues.some((cue) => normalized.includes(cue))) {
      return true;
    }

    const cuePatterns = [
      /\bdon'?t\s+know\b/i,
      /\bdo\s+not\s+know\b/i,
      /\bnot\s+sure\b/i,
      /\bno\s+(?:idea|clue)\b/i,
      /\bidk\b/i,
      /\b(can(?:not|'t)\s+answer)\b/i,
      /\b(can(?:not|'t)\s+recall)\b/i,
      /\b(?:unsure|uncertain)\b/i,
      /\b(?:unable|not\s+able)\s+to\s+answer\b/i,
    ];

    return cuePatterns.some((pattern) => pattern.test(normalized));
  }

  private extractQuestion(reply: string): string {
    const questionMatch = reply.match(/(?:Question:|Q:)([\s\S]*)/i);
    if (questionMatch && questionMatch[1]) {
      return questionMatch[1].trim();
    }
    return reply.trim();
  }

  private detectResponseSignal(message: string): ResponseSignal {
    const normalized = (message || '')
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .trim();
    const cleaned = normalized.replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();

    const endInterviewPhrases = [
      'end interview',
      'end the interview',
      'stop interview',
      'stop the interview',
      'finish interview',
      'finish the interview',
      'i want to end interview',
      'i want to end the interview',
      'let us end interview',
      "let's end interview",
      'interview is over',
      'that is all for now',
      'we can stop here',
    ];
    if (endInterviewPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'end_interview';
    }

    const directEndIntentPatterns = [
      /\b(end|stop|finish|close|quit|terminate)\b\s+(?:this\s+|the\s+)?\b(interview|session)\b/i,
      /\b(interview|session)\b\s+(?:is\s+)?\b(over|done|finished|ended)\b/i,
      /\b(can\s+you|could\s+you|please|i\s+want\s+to|let\s+us|let's)\b[\w\s']{0,30}\b(end|stop|finish|close)\b/i,
      /\b(end|stop|finish)\b\s+now\b/i,
    ];

    if (directEndIntentPatterns.some((pattern) => pattern.test(cleaned))) {
      return 'end_interview';
    }

    if (this.hasFuzzyEndInterviewIntent(cleaned)) {
      return 'end_interview';
    }


    const moveOnPhrases = [
      'move ahead',
      'move on',
      'move forward',
      'next question',
      'next one',
      'skip this',
      'skip question',
      'skip it',
      'go next',
      'proceed',
      'lets move on',
      "let's move on",
      'can we move on',
      'please move on',
      'go to next',
    ];

    const dontKnowPhrases = [
      "don't know",
      'dont know',
      'do not know',
      'not sure',
      'no idea',
      'no clue',
      'not aware',
      'unsure',
      'dunno',
      "don't have idea",
      'dont have idea',
      "don't have any idea",
      'dont have any idea',
      "don't remember",
      'cannot recall',
      'idk',
      "can't answer",
      'cannot answer',
      'i am not sure',
      "i'm not sure",
    ];

    const dontKnowPatterns = [
      /\bdon'?t\s+know\b/i,
      /\bdo\s+not\s+know\b/i,
      /\bnot\s+sure\b/i,
      /\bno\s+(?:idea|clue)\b/i,
      /\bidk\b/i,
      /\b(can(?:not|'t)\s+answer)\b/i,
      /\b(can(?:not|'t)\s+recall)\b/i,
      /\b(?:unsure|uncertain)\b/i,
    ];

    if (moveOnPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'move_on';
    }

    if (dontKnowPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'dont_know';
    }

    if (dontKnowPatterns.some((pattern) => pattern.test(cleaned))) {
      return 'dont_know';
    }

    const greetingOnlyRegex = /^(?:(?:hi|hello|hey|hola|good morning|good afternoon|good evening)(?:\s+(?:hi|hello|hey|there|team|all|everyone|sir|madam|mam))*)$/i;
    if (cleaned.length > 0 && cleaned.split(' ').length <= 6 && greetingOnlyRegex.test(cleaned)) {
      return 'greeting';
    }

    return 'normal';
  }

  private normalizeInterviewerTone(reply: string): string {
    return reply
      .replace(/^\s*\(\s*candidate\s+did\s+not\s+provide\s+an\s+answer\s+for\s+the\s+given\s+topic\.?\s*\)\s*$/gim, '')
      .replace(/^\s*\(\s*candidate\s+did\s+not\s+provide\s+an\s+answer[^)]*\)\s*$/gim, '')
      .replace(/^\s*\(\s*no\s+answer\s+provided[^)]*\)\s*$/gim, '')
      .replace(/^\s*\(\s*no\s+response\s+provided[^)]*\)\s*$/gim, '')
      .replace(/\byour\s+message\b/gi, 'that response')
      .replace(/\byour\s+response\s+was\b/gi, 'that was')
      .replace(/\byou\s+said\b/gi, 'from what I heard')
      .replace(/\blet'?s\s+focus\s+on\b/gi, 'let us focus on')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractRatingsAndCleanReply(reply: string): { cleanedReply: string; scores: SectionScores | null } {
    const ratingsRegex = /Section ratings\s*\(\/10\)\s*:\s*Theory\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Coding\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Scenario\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Output\s*:\s*(10|\d(?:\.\d+)?)/i;
    const match = reply.match(ratingsRegex);

    let scores: SectionScores | null = null;
    if (match) {
      const theory = Number.parseFloat(match[1]);
      const coding = Number.parseFloat(match[2]);
      const scenario = Number.parseFloat(match[3]);
      const output = Number.parseFloat(match[4]);
      const parsedScores = [theory, coding, scenario, output];
      const hasInvalidScore = parsedScores.some((value) => Number.isNaN(value));

      if (!hasInvalidScore) {
        scores = {
          theory: Math.max(0, Math.min(10, theory)),
          coding: Math.max(0, Math.min(10, coding)),
          scenario: Math.max(0, Math.min(10, scenario)),
          output: Math.max(0, Math.min(10, output)),
        };
      }
    }

    const cleanedReply = reply
      .replace(ratingsRegex, '')
      .replace(/^.*Section\s*ratings.*$/gim, '')
      .replace(/^.*Ratings\s+are\s+based\s+on.*$/gim, '')
      .replace(/^\s*\(\s*Note\s*:\s*Ratings.*\)\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { cleanedReply, scores };
  }

  private getSummary(session: InterviewSession) {
    if (session.scoreEntries <= 0) {
      return {
        hasScoreData: false,
        entries: 0,
        theoryAvg: 0,
        codingAvg: 0,
        scenarioAvg: 0,
        outputAvg: 0,
        overallAvg: 0,
      };
    }

    const theoryAvg = this.roundScore(session.scoreTotals.theory / session.scoreEntries);
    const codingAvg = this.roundScore(session.scoreTotals.coding / session.scoreEntries);
    const scenarioAvg = this.roundScore(session.scoreTotals.scenario / session.scoreEntries);
    const outputAvg = this.roundScore(session.scoreTotals.output / session.scoreEntries);
    const overallAvg = this.roundScore((theoryAvg + codingAvg + scenarioAvg + outputAvg) / 4);

    return {
      hasScoreData: true,
      entries: session.scoreEntries,
      theoryAvg,
      codingAvg,
      scenarioAvg,
      outputAvg,
      overallAvg,
    };
  }

  private buildGreetingReply(question: string) {
    const greetings = [
      'Hey, good to hear from you.',
      'Hi, glad you are here.',
      'Hello, nice to meet you.',
      'Hey there, great to connect.',
    ];

    const transitions = [
      'Let us continue with this one:',
      'Let us pick up where we left off:',
      'We can jump right back in:',
      'Let us keep going with this question:',
    ];

    const safeQuestion = (question || '').trim() || 'Can you walk me through your approach?';
    const seed = Date.now();
    const greeting = greetings[seed % greetings.length];
    const transition = transitions[(seed + 1) % transitions.length];

    return `${greeting} ${transition} ${safeQuestion}`;
  }

  private openai: OpenAI | null = null;

  private getOpenAIClient(): OpenAI {
    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    }

    return this.openai;
  }

  private buildSystemPrompt() {
    return `You are an experienced technical interviewer in a realistic one-on-one interview.

Style rules:
- Sound human, calm, and professional
- Keep replies short (2-4 sentences usually)
- No long explanations, no teaching mode, no model-answer dumps
- No bullet lists unless explicitly requested
- Avoid scripted/meta wording. Do not say phrases like "your message was" or "let's steer back".

Interview rules:
- Ask one focused question at a time
- After a candidate answer, give brief natural feedback and move to the next/follow-up question
- If the candidate response is off-topic, too vague, or casual, respond politely and guide them back to the current question
- If they ask to repeat or clarify the question, rephrase it briefly and continue

Do not break character as interviewer.
`;
  }

  async getAIResponse(message: string) {
    console.log('Incoming message:', message);
    console.log('API KEY:', process.env.GROQ_API_KEY);

    try {
      const response = await this.getOpenAIClient().chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(),
          },
          {
            role: 'user',
            content: message,
          },
        ],
      });

      console.log('OpenAI success');

      return {
        reply: response.choices[0].message.content,
      };
    } catch (error) {
      console.error('OpenAI ERROR:', error);
      return {
        reply: 'Something went wrong while fetching response.',
      };
    }
  }

  async casualChat(message: string) {
    console.log('Casual chat message:', message);

    try {
      const response = await this.getOpenAIClient().chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a friendly assistant. Have casual conversations, answer questions, or chat about anything. Be warm and helpful.',
          },
          {
            role: 'user',
            content: message,
          },
        ],
      });

      console.log('Casual chat success');

      return {
        reply: response.choices[0].message.content,
      };
    } catch (error) {
      console.error('Casual chat ERROR:', error);
      return {
        reply: 'Something went wrong. Let me try that again.',
      };
    }
  }

  async startInterview(config: InterviewConfig) {
    const level = config.level || 'medium';
    const experience = config.experience || '0-1 years';
    const topic = config.topic || 'JavaScript';
    const selfRating = config.selfRating || 5;

    const difficultyMap = {
      1: 'very basic and fundamental',
      2: 'basic with some gaps',
      3: 'beginner level',
      4: 'beginner approaching intermediate',
      5: 'intermediate level',
      6: 'intermediate with good knowledge',
      7: 'advanced intermediate',
      8: 'advanced level',
      9: 'very advanced',
      10: 'expert level'
    };

    const questionDifficulty = selfRating <= 3 ? 'beginner' : selfRating <= 6 ? 'intermediate' : 'advanced';

    const startPrompt = `Start a realistic technical interview with a candidate.

Setup:
- Interview difficulty: ${level}
- Candidate experience: ${experience}
- Topic to be interviewed on: ${topic}
- Candidate's self-rated skill level: ${selfRating}/10 (${difficultyMap[selfRating] || 'intermediate'})
- Adjust question difficulty to ${questionDifficulty}

Greet them naturally in one short sentence using their self-rating context. Then immediately ask the first interview question on ${topic}.

Tailor the question difficulty based on their self-rating:
- If they rated 1-3: Ask a foundational question
- If they rated 4-6: Ask an intermediate question
- If they rated 7-10: Ask a challenging question

Keep it conversational and concise. Ask exactly ONE focused question.
`;

    const result = await this.getAIResponse(startPrompt);
    const rawReply = result.reply || 'No response from interviewer.';
    const { cleanedReply } = this.extractRatingsAndCleanReply(rawReply);
    const message = this.normalizeInterviewerTone(cleanedReply) || 'No response from interviewer.';
    const question = this.extractQuestion(message);

    const sessionId = this.createSessionId();
    const session: InterviewSession = {
      id: sessionId,
      config: {
        level,
        experience,
        topic,
        selfRating,
      },
      lastQuestion: question,
      stuckAttemptsForCurrentQuestion: 0,
      scoreTotals: this.createEmptyScores(),
      scoreEntries: 0,
    };

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      message,
      question,
      meta: {
        topic,
        difficulty: questionDifficulty,
      },
      summary: this.getSummary(session),
    };
  }

  async endInterview(sessionId?: string) {
    const normalizedSessionId = (sessionId || '').trim();
    if (!normalizedSessionId) {
      return {
        error: 'Session not found. Please start a new interview.',
      };
    }

    const session = this.sessions.get(normalizedSessionId);
    if (!session) {
      return {
        error: 'Session not found. Please start a new interview.',
      };
    }

    const summary = this.getSummary(session);
    this.sessions.delete(normalizedSessionId);

    return {
      sessionId: normalizedSessionId,
      ended: true,
      message: 'Okay, ending the interview. Here is your summary.',
      summary,
    };
  }

  async evaluateAnswer(payload: AnswerPayload) {
    const answer = payload.answer || '';
    const sessionId = payload.sessionId || '';
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        error: 'Session not found. Please start a new interview.',
      };
    }

    const level = session.config.level || 'medium';
    const experience = session.config.experience || '0-1 years';
    const topic = session.config.topic || 'JavaScript';
    const question = session.lastQuestion || 'Interview question';
    const responseSignal = this.detectResponseSignal(answer);
    const shouldCaptureScore = responseSignal === 'normal' && this.isSubstantiveAnswer(answer) && !this.hasUncertaintyCue(answer);

    if (responseSignal === 'end_interview') {
      const summary = this.getSummary(session);
      this.sessions.delete(sessionId);

      return {
        sessionId,
        ended: true,
        message: 'Okay, ending the interview. Here is your summary.',
        question: '',
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged: false,
          stuckAttempts: session.stuckAttemptsForCurrentQuestion,
        },
        summary,
      };
    }

    if (responseSignal === 'dont_know' || responseSignal === 'move_on') {
      session.stuckAttemptsForCurrentQuestion += 1;
    } else {
      session.stuckAttemptsForCurrentQuestion = 0;
    }

    const stuckAttempts = session.stuckAttemptsForCurrentQuestion;

    if (responseSignal === 'greeting') {
      const message = this.buildGreetingReply(question);
      return {
        sessionId,
        message,
        question,
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged: false,
          stuckAttempts,
        },
        summary: this.getSummary(session),
      };
    }

    if (responseSignal === 'move_on' || (responseSignal === 'dont_know' && stuckAttempts >= 2)) {
      const moveAheadPrompt = `The candidate wants to move ahead in the interview.

Current context:
- Topic: ${topic}
- Difficulty: ${level}
- Experience: ${experience}

Previous question (do not repeat or rephrase this):
"${question}"

Candidate message:
"${answer}"

Respond exactly like a real interviewer:
- Acknowledge briefly in one natural sentence.
- Ask ONE new question immediately.
- The new question must be different from the previous one.
- Do not ask the candidate to retry the previous question.
- Do not provide hints or long explanations.
- Keep it concise and human.
`;

      const result = await this.getAIResponse(moveAheadPrompt);
      const rawReply = result.reply || 'No response from interviewer.';
      const { cleanedReply, scores } = this.extractRatingsAndCleanReply(rawReply);
      const message = this.normalizeInterviewerTone(cleanedReply) || 'No response from interviewer.';
      const nextQuestion = this.extractQuestion(message);
      const questionChanged = nextQuestion !== session.lastQuestion;

      if (scores && shouldCaptureScore) {
        session.scoreTotals.theory += scores.theory;
        session.scoreTotals.coding += scores.coding;
        session.scoreTotals.scenario += scores.scenario;
        session.scoreTotals.output += scores.output;
        session.scoreEntries += 1;
      }

      if (questionChanged) {
        session.lastQuestion = nextQuestion;
        session.stuckAttemptsForCurrentQuestion = 0;
      }

      return {
        sessionId,
        message,
        question: nextQuestion,
        evaluation: shouldCaptureScore ? scores : null,
        progress: {
          responseSignal,
          questionChanged,
          stuckAttempts: session.stuckAttemptsForCurrentQuestion,
        },
        summary: this.getSummary(session),
      };
    }

    const prompt = `You are conducting an interview turn.

Current interview context:
- Topic: ${topic}
- Difficulty: ${level}
- Experience: ${experience}

Current question asked to candidate:
"${question}"

Candidate's latest message:
"${answer}"

Detected candidate intent:
- responseSignal: ${responseSignal}
- stuckAttemptsOnCurrentQuestion: ${stuckAttempts}

Respond like a real interviewer using these rules:
- If the candidate gave a relevant answer: give short feedback (1-2 sentences) and ask one follow-up or next question.
- If responseSignal is greeting: greet back naturally in one short sentence, then continue the interview by asking the current question.
- If the candidate message is off-topic/casual/small-talk: acknowledge briefly and return to the current question in a natural way.
- If the candidate asks for clarification/repeat: rephrase the same question briefly.
- If responseSignal is move_on: acknowledge briefly and move to a new question immediately (no hint).
- If responseSignal is dont_know and stuckAttemptsOnCurrentQuestion is 1: give one tiny hint (one sentence max) and ask them to try once.
- If responseSignal is dont_know and stuckAttemptsOnCurrentQuestion is 2 or more: acknowledge and move to a new question immediately without another hint.
- For relevant answers, also include section-wise ratings out of 10 in one compact line using this exact label format:
  Section ratings (/10): Theory: X | Coding: X | Scenario: X | Output: X
- Derive the four section ratings from the candidate's latest response quality (0-10 each).

Critical constraints:
- Do NOT provide full answers or long explanations.
- Do NOT produce long educational content.
- Keep it concise and human (3-5 short sentences including the ratings line).
- Do NOT quote the candidate's exact message unless they asked you to repeat it.
- Never use phrasing like "your message", "your response was", or "you said" in a meta/robotic way.
- Speak like a person in a live interview conversation.
- End with one clear interviewer question.
`;

    const result = await this.getAIResponse(prompt);
    const rawReply = result.reply || 'No response from interviewer.';
    const { cleanedReply, scores } = this.extractRatingsAndCleanReply(rawReply);
    const message = this.normalizeInterviewerTone(cleanedReply) || 'No response from interviewer.';
    const nextQuestion = this.extractQuestion(message);
    const questionChanged = nextQuestion !== session.lastQuestion;

    if (scores && shouldCaptureScore) {
      session.scoreTotals.theory += scores.theory;
      session.scoreTotals.coding += scores.coding;
      session.scoreTotals.scenario += scores.scenario;
      session.scoreTotals.output += scores.output;
      session.scoreEntries += 1;
    }

    if (questionChanged) {
      session.lastQuestion = nextQuestion;
      session.stuckAttemptsForCurrentQuestion = 0;
    }

    return {
      sessionId,
      message,
      question: nextQuestion,
      evaluation: shouldCaptureScore ? scores : null,
      progress: {
        responseSignal,
        questionChanged,
        stuckAttempts: session.stuckAttemptsForCurrentQuestion,
      },
      summary: this.getSummary(session),
    };
  }
}
