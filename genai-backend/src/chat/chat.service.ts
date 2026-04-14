import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

type ResponseSignal = 'normal' | 'dont_know' | 'move_on' | 'greeting' | 'end_interview' | 'clarification';

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

interface ConversationEntry {
  role: 'interviewer' | 'candidate';
  content: string;
}

interface InterviewSession {
  id: string;
  config: Required<InterviewConfig>;
  lastQuestion: string;
  stuckAttemptsForCurrentQuestion: number;
  greetingAttemptsForCurrentQuestion: number;
  redirectAttemptsForCurrentQuestion: number;
  scoreTotals: SectionScores;
  scoreEntries: number;
  history: ConversationEntry[];
}

interface InterviewTurnResponse {
  rawText: string;
  feedback: string;
  decision: string;
  nextQuestion: string;
  isStructured: boolean;
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

  private hasFuzzyDontKnowCue(cleaned: string): boolean {
    const tokens = cleaned
      .split(/\s+/)
      .map((token) => token.replace(/'/g, ''))
      .filter(Boolean);

    if (tokens.length === 0) return false;

    const hasDontWord = tokens.some((token) => this.isApproxWord(token, 'dont', 1));
    const hasDoWord = tokens.some((token) => this.isApproxWord(token, 'do', 0));
    const hasNotWord = tokens.some((token) => this.isApproxWord(token, 'not', 1));
    const hasKnowWord = tokens.some((token) => this.isApproxWord(token, 'know', 1));
    const hasIdeaWord = tokens.some((token) => this.isApproxWord(token, 'idea', 1));

    return (hasKnowWord && (hasDontWord || (hasDoWord && hasNotWord))) || (hasNotWord && hasIdeaWord);
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
      "i don't know",
      'i dont know',
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
      'i have no idea',
      'cannot remember',
      'i am blanking',
      "i'm blanking",
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
      /\bblanking\b/i,
    ];

    return cuePatterns.some((pattern) => pattern.test(normalized));
  }

  private hasClarificationCue(answer: string): boolean {
    const normalized = (answer || '')
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .trim();

    if (!normalized) return false;

    const phrases = [
      'can you repeat',
      'could you repeat',
      'would you repeat',
      'please repeat',
      'repeat the question',
      'say that again',
      'come again',
      'can you rephrase',
      'could you rephrase',
      'please rephrase',
      'can you explain the question',
      'i did not understand',
      "i didn't understand",
      'did not get you',
      "didn't get you",
      'what do you mean',
    ];

    if (phrases.some((phrase) => normalized.includes(phrase))) {
      return true;
    }

    const patterns = [
      /^\s*what\??\s*$/i,
      /^\s*pardon\??\s*$/i,
      /\b(?:can|could|would)\s+you\s+(?:repeat|rephrase|explain)\b/i,
      /\bsay\s+that\s+again\b/i,
      /\bdid(?:\s+not|n't)\s+(?:get|understand)\b/i,
    ];

    return patterns.some((pattern) => pattern.test(normalized));
  }

  private extractJsonLikeField(rawText: string, fieldName: 'feedback' | 'decision' | 'nextQuestion'): string {
    const text = (rawText || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    if (!text) return '';

    const patterns = [
      new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,\\s*"[^"]+"\\s*:|\\s*}\\s*$)`, 'i'),
      new RegExp(`'${fieldName}'\\s*:\\s*'([\\s\\S]*?)'(?=\\s*,\\s*'[^']+'\\s*:|\\s*}\\s*$)`, 'i'),
      new RegExp(`${fieldName}\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,\\s*[a-zA-Z"]+\\s*:|\\s*}\\s*$)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .trim();
      }
    }

    return '';
  }

  private recoverStructuredPayload(rawText: string): any | null {
    const feedback = this.extractJsonLikeField(rawText, 'feedback');
    const decision = this.extractJsonLikeField(rawText, 'decision');
    const nextQuestion = this.extractJsonLikeField(rawText, 'nextQuestion');

    if (!feedback && !decision && !nextQuestion) {
      return null;
    }

    return {
      feedback,
      decision: (decision || 'NEXT').trim().toUpperCase(),
      nextQuestion: nextQuestion || 'Can you explain this in more detail?',
    };
  }

  private extractQuestion(reply: string): string {
    const text = (reply || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    const questionMatch = text.match(/(?:Question:|Q:)([\s\S]*)/i);
    if (questionMatch && questionMatch[1]) {
      return questionMatch[1].trim();
    }

    const lastQIndex = text.lastIndexOf('?');
    if (lastQIndex !== -1) {
      const prefix = text.slice(0, lastQIndex + 1);
      const boundary = Math.max(
        prefix.lastIndexOf('. '),
        prefix.lastIndexOf('! '),
        prefix.lastIndexOf('? '),
        prefix.lastIndexOf('\n'),
      );
      const candidate = prefix.slice(boundary >= 0 ? boundary + 1 : 0).trim();
      if (candidate) return candidate;
    }

    return text;
  }

  private isVagueOrOffTopicInterruption(message: string): boolean {
    const normalized = (message || '')
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .trim();
    const cleaned = normalized.replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();

    if (!cleaned) return false;

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const uniqueTokenCount = new Set(tokens).size;
    const shortCasualSingle = new Set([
      'ok', 'okay', 'hmm', 'huh', 'lol', 'haha', 'yes', 'no', 'sure', 'fine', 'great', 'cool', 'alright', 'maybe',
    ]);

    if (tokens.length <= 2 && tokens.every((t) => shortCasualSingle.has(t))) {
      return true;
    }

    const smallTalkPhrases = [
      'how are you',
      "how's it going",
      'hows it going',
      'what is up',
      "what's up",
      'whats up',
      'nice to meet you',
      'thank you',
      'thanks',
      'good one',
    ];

    if (smallTalkPhrases.some((phrase) => normalized.includes(phrase))) {
      return true;
    }

    const technicalCueRegex = /\b(function|method|class|object|array|string|number|boolean|scope|closure|context|this|bind|call|apply|prototype|recursion|stack|javascript|js|typescript|async|await|promise|loop|algorithm)\b/i;
    const repetitiveNoise = tokens.length >= 2 && uniqueTokenCount === 1;
    const lowSignalNoise = tokens.length <= 5 && uniqueTokenCount <= 2 && !technicalCueRegex.test(cleaned);

    if (repetitiveNoise || lowSignalNoise) {
      return true;
    }

    return false;
  }

  private formatRecentHistory(history: ConversationEntry[], maxEntries = 10): string {
    if (!history || history.length === 0) return '';
    const recent = history.slice(-maxEntries);
    return recent
      .map((e) => `${e.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${e.content}`)
      .join('\n');
  }

  private appendHistory(session: InterviewSession, candidateMsg: string, interviewerMsg: string): void {
    session.history.push({ role: 'candidate', content: candidateMsg });
    session.history.push({ role: 'interviewer', content: interviewerMsg });
    // keep last 20 entries (10 exchanges) to stay within token budget
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }
  }

  private summarizeUserSnippet(message: string, maxWords = 4): string {
    const words = (message || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1)
      .slice(0, maxWords);

    return words.join(' ') || 'that response';
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

    if (this.hasClarificationCue(message)) {
      return 'clarification';
    }

    const moveOnPhrases = [
      'move ahead',
      'move on',
      'move forward',
      'next question',
      'next one',
      'skip this',
      'skip this one',
      'skip question',
      'skip it',
      'go next',
      'proceed',
      'lets move on',
      "let's move on",
      'can we move on',
      'please move on',
      'go to next',
      'ask another question',
      'ask next question',
      'give me next question',
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
      'i have no idea',
      'cannot remember',
      'i am blanking',
      "i'm blanking",
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
      /\bblanking\b/i,
    ];

    if (moveOnPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'move_on';
    }

    if (dontKnowPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'dont_know';
    }

    if (dontKnowPatterns.some((pattern) => pattern.test(cleaned)) || this.hasFuzzyDontKnowCue(cleaned)) {
      return 'dont_know';
    }

    const greetingOnlyRegex = /^(?:(?:hi|hello|hey|hola|good morning|good afternoon|good evening)(?:\s+(?:hi|hello|hey|hola|good morning|good afternoon|good evening|there|team|all|everyone|sir|madam|mam))*)$/i;
    const acknowledgmentOnlyRegex = /^(?:ok|okay|alright|sure|got it|sounds good|understood|i see|noted|yep|yup|yeah|cool|great|nice|right|go on|go ahead|fine|hmm+|ah+|oh okay|oh ok|oh right|ok cool|ok sure|ok fine|ok alright)$/i;
    if (cleaned.length > 0 && (greetingOnlyRegex.test(cleaned) || acknowledgmentOnlyRegex.test(cleaned))) {
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

  private ensureOpeningGreeting(reply: string): string {
    const text = (reply || '').trim();
    if (!text) return 'Welcome, let us get started.';

    const greetingRegex = /^(welcome|hello|hi\b|good\s+to\s+have\s+you\s+here|nice\s+to\s+meet\s+you)/i;
    if (greetingRegex.test(text)) {
      return text;
    }

    const withoutAck = text.replace(/^(got it|sure|alright|fair enough|no worries|okay|ok|great)\s*[.!,-]*\s*/i, '').trim();
    const content = withoutAck || text;

    return `Welcome, let us get started.\n\n${content}`.trim();
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

  private buildInterviewerMessage(response: InterviewTurnResponse): string {
    if (!response?.isStructured) {
      const recovered = this.recoverStructuredPayload(response?.rawText || '');
      if (recovered) {
        return [recovered.feedback, recovered.nextQuestion].filter(Boolean).join('\n\n').trim();
      }

      return response?.rawText || response?.feedback || 'No response from interviewer.';
    }

    const feedback = (response.feedback || '').trim();
    const nextQuestion = (response.nextQuestion || '').trim();

    if (feedback && nextQuestion) {
      return `${feedback}\n\n${nextQuestion}`;
    }

    return feedback || nextQuestion || 'No response from interviewer.';
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

  private buildGreetingReply(question: string, repeatCount: number, answer: string) {
    const safeQuestion = this.extractQuestion(question || '').trim() || 'Can you walk me through your approach?';
    const snippet = this.summarizeUserSnippet(answer, 3);

    if (repeatCount <= 1) {
      const firstReplies = [
        `Hey, good to hear from you. Can you walk me through this: ${safeQuestion}`,
        `Hi there. Let us keep going with this: ${safeQuestion}`,
        `Nice to hear from you. Please answer this: ${safeQuestion}`,
      ];
      return firstReplies[Math.floor(Math.random() * firstReplies.length)];
    }

    if (repeatCount === 2) {
      const secondReplies = [
        `No worries, I heard "${snippet}". When you are ready, answer this question: ${safeQuestion}`,
        `All good, I got "${snippet}". Let us continue with: ${safeQuestion}`,
      ];
      return secondReplies[Math.floor(Math.random() * secondReplies.length)];
    }

    const repeatReplies = [
      `I hear "${snippet}" again. Please choose one: answer this question now, or say "move on". ${safeQuestion}`,
      `You are repeating greetings ("${snippet}"). Please choose one: answer now, or say "move on". ${safeQuestion}`,
    ];
    return repeatReplies[Math.floor(Math.random() * repeatReplies.length)];
  }

  private buildOffTopicRedirectReply(question: string, repeatCount: number, answer: string): string {
    const safeQuestion = this.extractQuestion(question || '').trim() || 'Can you walk me through your approach?';
    const snippet = this.summarizeUserSnippet(answer);

    if (repeatCount <= 1) {
      const firstNudges = [
        `I heard "${snippet}", but that drifts from the current question. Kindly focus on this: ${safeQuestion}`,
        `Got "${snippet}". Let us keep the interview on track and answer this: ${safeQuestion}`,
        `Fair point on "${snippet}". Now please answer the current question: ${safeQuestion}`,
      ];
      return firstNudges[Math.floor(Math.random() * firstNudges.length)];
    }

    if (repeatCount === 2) {
      return `We are still off topic ("${snippet}"). Let us focus on this one now: ${safeQuestion}`;
    }

    return `I am still hearing "${snippet}" and not a real attempt. Please either answer now, or say "move on" and I will switch the question.`;
  }

  private getQuestionBank(topic: string): string[] {
    const normalizedTopic = (topic || '').toLowerCase();

    if (normalizedTopic.includes('javascript')) {
      return [
        'What is hoisting in JavaScript?',
        'What is a closure in JavaScript?',
        'What is the difference between == and === in JavaScript?',
        'How do promises differ from async and await in JavaScript?',
      ];
    }

    if (normalizedTopic.includes('typescript')) {
      return [
        'What is the difference between an interface and a type in TypeScript?',
        'What are generics in TypeScript?',
        'What is the purpose of union types in TypeScript?',
      ];
    }

    if (normalizedTopic.includes('angular')) {
      return [
        'What is the difference between components and services in Angular?',
        'What is dependency injection in Angular?',
        'How does change detection work in Angular?',
      ];
    }

    if (normalizedTopic.includes('react')) {
      return [
        'What is the difference between state and props in React?',
        'What is the purpose of useEffect in React?',
        'What problem does the virtual DOM solve in React?',
      ];
    }

    if (normalizedTopic.includes('node')) {
      return [
        'What is the event loop in Node.js?',
        'What is the difference between synchronous and asynchronous code in Node.js?',
        'What are middleware functions used for on the backend?',
      ];
    }

    if (normalizedTopic.includes('nest')) {
      return [
        'What is the role of a module in NestJS?',
        'What is dependency injection in NestJS?',
        'What is the difference between a controller and a service in NestJS?',
      ];
    }

    if (normalizedTopic.includes('sql') || normalizedTopic.includes('postgres') || normalizedTopic.includes('mongo')) {
      return [
        'What is the difference between a primary key and a foreign key?',
        'What is a database index and why is it useful?',
        'What is the difference between an inner join and a left join?',
      ];
    }

    if (normalizedTopic.includes('python')) {
      return [
        'What is the difference between a list and a tuple in Python?',
        'What is a dictionary in Python?',
        'How does list comprehension help in Python?',
      ];
    }

    return [
      `What is one core concept in ${topic} that you know well?`,
      `Can you explain a practical use case related to ${topic}?`,
      `What is a common challenge developers face with ${topic}?`,
    ];
  }

  private isQuestionSimilar(left: string, right: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const a = normalize(left);
    const b = normalize(right);

    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;

    const stopWords = new Set(['what', 'which', 'when', 'where', 'why', 'how', 'the', 'and', 'with', 'from', 'into', 'your', 'this', 'that', 'does']);
    const aTokens = new Set(a.split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token)));
    const bTokens = new Set(b.split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token)));

    if (!aTokens.size || !bTokens.size) return false;

    const overlapCount = [...aTokens].filter((token) => bTokens.has(token)).length;
    const overlapRatio = overlapCount / Math.max(aTokens.size, bTokens.size);

    return overlapRatio >= 0.6;
  }

  private buildMoveOnReply(topic: string, previousQuestion: string): { message: string; nextQuestion: string } {
    const nextQuestion = this.getQuestionBank(topic).find((candidate) => !this.isQuestionSimilar(candidate, previousQuestion))
      || this.getQuestionBank(topic)[0]
      || `Can you explain one core idea in ${topic}?`;

    return {
      message: `No problem. Let us move on.\n\n${nextQuestion}`,
      nextQuestion,
    };
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
    return `You are a real, experienced technical interviewer conducting a live 1-on-1 interview.

Return ONLY one JSON object with this exact shape:
{
  "feedback": "1-2 short natural sentences",
  "decision": "FOLLOW_UP | NEXT | CHANGE_TOPIC | REPEAT | END",
  "nextQuestion": "one interview question"
}

STRICT RULES:
- No markdown fences
- No extra text before or after the JSON object
- No trailing commas
- ALWAYS include "nextQuestion" and keep it non-empty unless decision is END
- ALWAYS ask exactly ONE question
- feedback must sound casual and human: "Got it.", "Sure.", "Fair enough.", "No worries."
- NEVER use formal or robotic phrases like "Kindly", "That drifts from", or "Your response was"
- NEVER quote back the candidate's exact words in quote marks inside feedback
- If the candidate asks to repeat or clarify, use decision REPEAT and restate the same question more simply
`;
  }

  private tryParseStructuredPayload(rawText: string): any | null {
    const text = (rawText || '').trim();
    if (!text) return null;

    const normalized = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();

    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    const candidate = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? normalized.slice(firstBrace, lastBrace + 1)
      : normalized;

    const attempts = [
      candidate,
      candidate.replace(/,\s*([}\]])/g, '$1'),
      candidate.replace(/([{,]\s*)(feedback|decision|nextQuestion)(\s*:)/gi, '$1"$2"$3'),
      candidate
        .replace(/([{,]\s*)(feedback|decision|nextQuestion)(\s*:)/gi, '$1"$2"$3')
        .replace(/,\s*([}\]])/g, '$1'),
    ];

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch {
        // continue to the next normalization attempt
      }
    }

    return this.recoverStructuredPayload(candidate);
  }

  async getAIResponse(message: string) {
    console.log('Incoming message:', message);

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

      const rawText = response.choices[0].message.content || '';

      try {
        const parsed = this.tryParseStructuredPayload(rawText);
        if (!parsed) {
          throw new Error('Invalid JSON payload');
        }

        // 🔥 FIX 3 (ADD HERE)
        if (!parsed.nextQuestion || parsed.nextQuestion.trim().length === 0) {
          parsed.nextQuestion = "Can you explain this in more detail?";
        }

        return {
          rawText,
          feedback: parsed.feedback || '',
          decision: String(parsed.decision || 'NEXT').toUpperCase(),
          nextQuestion: parsed.nextQuestion,
          isStructured: true,
        };

      } catch (err) {
        console.warn('⚠️ JSON parse failed:', rawText);
        const sanitized = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        return {
          rawText: sanitized,
          feedback: sanitized,
          decision: 'NEXT',
          nextQuestion: this.extractQuestion(sanitized),
          isStructured: false,
        };
      }

    } catch (error) {
      console.error('AI ERROR:', error);

      return {
        rawText: '',
        feedback: 'Something went wrong.',
        decision: 'NEXT',
        nextQuestion: '',
        isStructured: false,
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
    const questionDifficulty = level;

    const startPrompt = `Start a realistic technical interview with a candidate.

Setup:
- Interview difficulty: ${level}
- Candidate experience: ${experience}
- Topic to be interviewed on: ${topic}
- Ask the first question at ${questionDifficulty} level

Begin with a single brief professional welcome sentence starting with a greeting such as "Welcome, let's get started." or "Good to have you here.". Do NOT begin with acknowledgments like "Got it", "Sure", or "Fair enough". Then immediately ask the first interview question on ${topic}.

Keep it concise. Ask exactly ONE focused question.
`;

    const aiResponse = await this.getAIResponse(startPrompt);
    const rawReply = this.buildInterviewerMessage(aiResponse);
    const { cleanedReply } = this.extractRatingsAndCleanReply(rawReply);
    const message = this.ensureOpeningGreeting(this.normalizeInterviewerTone(cleanedReply) || 'No response from interviewer.');
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
      greetingAttemptsForCurrentQuestion: 0,
      redirectAttemptsForCurrentQuestion: 0,
      scoreTotals: this.createEmptyScores(),
      scoreEntries: 0,
      history: [{ role: 'interviewer', content: message }],
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

    if (responseSignal === 'clarification') {
      session.greetingAttemptsForCurrentQuestion = 0;
      session.redirectAttemptsForCurrentQuestion = 0;

      const safeQuestion = this.extractQuestion(question || '').trim() || 'Can you walk me through your answer?';
      const message = `Sure, here is the question again:\n\n${safeQuestion}`;
      this.appendHistory(session, answer, message);

      return {
        sessionId,
        message,
        question: safeQuestion,
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged: false,
          stuckAttempts: session.stuckAttemptsForCurrentQuestion,
        },
        summary: this.getSummary(session),
      };
    }

    if (responseSignal === 'dont_know' || responseSignal === 'move_on') {
      session.stuckAttemptsForCurrentQuestion += 1;
      session.greetingAttemptsForCurrentQuestion = 0;
      session.redirectAttemptsForCurrentQuestion = 0;
    } else if (responseSignal === 'greeting') {
      session.greetingAttemptsForCurrentQuestion += 1;
      session.redirectAttemptsForCurrentQuestion = 0;
    } else {
      session.stuckAttemptsForCurrentQuestion = 0;
      session.greetingAttemptsForCurrentQuestion = 0;
    }

    const stuckAttempts = session.stuckAttemptsForCurrentQuestion;
    const isUnclearResponse =
      responseSignal === 'normal' &&
      this.isVagueOrOffTopicInterruption(answer) &&
      !this.isSubstantiveAnswer(answer) &&
      !this.hasUncertaintyCue(answer);

    if (responseSignal === 'dont_know' && stuckAttempts >= 2) {
      const { message, nextQuestion } = this.buildMoveOnReply(topic, question);

      session.lastQuestion = nextQuestion;
      session.stuckAttemptsForCurrentQuestion = 0;
      session.greetingAttemptsForCurrentQuestion = 0;
      session.redirectAttemptsForCurrentQuestion = 0;
      this.appendHistory(session, answer, message);

      return {
        sessionId,
        message,
        question: nextQuestion,
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged: true,
          stuckAttempts: 0,
        },
        summary: this.getSummary(session),
      };
    }

    if (isUnclearResponse) {
      session.redirectAttemptsForCurrentQuestion += 1;
    } else if (responseSignal !== 'greeting') {
      session.redirectAttemptsForCurrentQuestion = 0;
    }

    if (isUnclearResponse) {
      const unclearAttemptCount = session.redirectAttemptsForCurrentQuestion;

      if (unclearAttemptCount >= 2) {
        const summary = this.getSummary(session);
        this.sessions.delete(sessionId);

        return {
          sessionId,
          ended: true,
          message: 'I am still not able to understand your response, so I am ending this interview for now. Please restart when you are ready.',
          question: '',
          evaluation: null,
          progress: {
            responseSignal,
            questionChanged: false,
            stuckAttempts,
          },
          summary,
        };
      }

      const safeQuestion = this.extractQuestion(question || '').trim() || 'Can you walk me through your answer?';
      const message = `I could not fully understand what you meant. Could you rephrase your answer in one clear sentence?\n\n${safeQuestion}`;
      this.appendHistory(session, answer, message);

      return {
        sessionId,
        message,
        question: safeQuestion,
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged: false,
          stuckAttempts,
        },
        summary: this.getSummary(session),
      };
    }

    if (responseSignal === 'greeting') {
      const safeQuestion = this.extractQuestion(question || '').trim() || 'Can you walk me through your answer?';
      const repeatCount = session.greetingAttemptsForCurrentQuestion;
      let message = '';

      if (repeatCount <= 1) {
        message = `I asked a question. Please answer it in your own words, or say "move on" if you want to skip.\n\n${safeQuestion}`;
      } else if (repeatCount === 2) {
        message = `Saying "hello" repeatedly will not help in an interview. Please answer the question now, or type "move on" to skip.\n\n${safeQuestion}`;
      } else if (repeatCount === 3) {
        message = `This is your final reminder: please answer the question instead of repeating greetings. If you continue, I will end this interview.\n\n${safeQuestion}`;
      } else {
        const summary = this.getSummary(session);
        this.sessions.delete(sessionId);

        return {
          sessionId,
          ended: true,
          message: 'I am ending this interview because you are repeatedly not coordinating with the interview flow. Please restart when you are ready to answer questions.',
          question: '',
          evaluation: null,
          progress: {
            responseSignal,
            questionChanged: false,
            stuckAttempts,
          },
          summary,
        };
      }

      this.appendHistory(session, answer, message);

      return {
        sessionId,
        message,
        question: safeQuestion,
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
      const { message, nextQuestion } = this.buildMoveOnReply(topic, question);
      const questionChanged = nextQuestion !== session.lastQuestion;

      if (questionChanged) {
        session.lastQuestion = nextQuestion;
        session.stuckAttemptsForCurrentQuestion = 0;
        session.greetingAttemptsForCurrentQuestion = 0;
        session.redirectAttemptsForCurrentQuestion = 0;
      }
      this.appendHistory(session, answer, message);

      return {
        sessionId,
        message,
        question: nextQuestion,
        evaluation: null,
        progress: {
          responseSignal,
          questionChanged,
          stuckAttempts: session.stuckAttemptsForCurrentQuestion,
        },
        summary: this.getSummary(session),
      };
    }

    const greetingCount = session.greetingAttemptsForCurrentQuestion;
    const redirectCount = session.redirectAttemptsForCurrentQuestion;
    const recentHistory = this.formatRecentHistory(session.history);

    const prompt = `You are a real, experienced technical interviewer in a live 1-on-1 conversation.

Topic: ${topic} | Difficulty: ${level}
${recentHistory ? `\nConversation so far:\n${recentHistory}\n` : ''}
Current question you asked:
"${question}"

Candidate's latest reply:
"${answer}"

Candidate state: signal=${responseSignal}${stuckAttempts > 0 ? `, stuck=${stuckAttempts}` : ''}${greetingCount > 0 ? `, greeting_repeat=${greetingCount}` : ''}${isUnclearResponse ? ', off_topic=true' : ''}

Respond exactly as a real senior developer would in a live interview — natural, brief, and human.
Use the conversation history above to make your response feel continuous and contextually relevant.

Rules by situation:
- Substantive answer → brief acknowledgment (1 sentence) + one follow-up or new question
- signal=dont_know, stuck=1 → one short nudge that reframes the question differently (NOT a lesson), then ask the same question in completely different words
- signal=dont_know, stuck≥2 → one phrase like "Fair enough." then immediately ask a BRAND NEW question on the same topic — NOT the same question, NOT a rephrasing of it
- signal=greeting (includes "ok", "okay", "alright", "sure", "got it", "yeah" etc.) → one casual phrase (e.g. "Go ahead.") then restate the current question in naturally different words — do NOT copy it verbatim from history
- signal=move_on → one casual acknowledgment then a DIFFERENT question — never repeat or rephrase anything from the last 2–3 exchanges in the history
- Candidate asked for clarification (e.g. "what?", "didn't get you", "can you repeat", "I didn't understand") → look at your last message in the conversation history and rephrase that specific thing much more simply
- Off-topic or vague (off_topic=true) → one word like "Sure." then restate the question in different words (not a copy)

Tone (critical):
- Sound like a person, NOT a chatbot or a teacher
- Short: 1–2 sentences max before the question
- Use casual phrases: "Got it.", "Sure.", "Fair enough.", "No worries.", "Alright."
- NEVER say: "Kindly", "That drifts from", "Your response was", "I notice that", "Let us focus on"
- NEVER quote back the candidate's exact words in quotation marks
- NEVER give lectures or multi-step explanations
- Always end with exactly ONE question

For substantive answers only, add this line at the end:
Section ratings (/10): Theory: X | Coding: X | Scenario: X | Output: X
`;


    const aiResponse = await this.getAIResponse(prompt);

    // Build the full message: feedback + nextQuestion combined
    const rawReply = this.buildInterviewerMessage(aiResponse);
    const { cleanedReply, scores: parsedScores } = this.extractRatingsAndCleanReply(rawReply);
    let message = this.normalizeInterviewerTone(cleanedReply) || 'No response from interviewer.';
    let nextQuestion = aiResponse.isStructured
      ? (aiResponse.nextQuestion || '').trim()
      : this.extractQuestion(message);

    // fallback safety
    if (!nextQuestion || nextQuestion.trim().length === 0) {
      nextQuestion = "Can you explain this in more detail?";
    }
    let scores: SectionScores | null = parsedScores;

    //  Decision handling
    if (aiResponse.decision === 'END') {
      return this.endInterview(sessionId);
    }

    if (aiResponse.decision === 'REPEAT') {
      nextQuestion = session.lastQuestion;
    }

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
      session.greetingAttemptsForCurrentQuestion = 0;
      session.redirectAttemptsForCurrentQuestion = 0;
    }

    this.appendHistory(session, answer, message);

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
