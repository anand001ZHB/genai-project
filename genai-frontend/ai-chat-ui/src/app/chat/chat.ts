import { Component, AfterViewChecked, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css']
})
export class Chat implements AfterViewChecked {

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('ratingInput') ratingInput?: ElementRef<HTMLInputElement>;

  private apiBaseUrl = ((environment as any).apiBaseUrl || (environment as any).apiUrl || '').replace(/\/+$/, '') || '';

  userInput = '';
  level = 'easy';
  experience = '0-1 years';
  topic = 'JavaScript';
  selfRating = '';
  showRatingStep = false;
  interviewStarted = false;
  isAnswerTurn = false;
  isAwaitingResponse = false;
  lastQuestion = '';
  messages: any[] = [];
  private messageIdCounter = 0;
  private pendingAnswerFocus = false;
  private pendingRatingFocus = false;
  showScrollButton = false;
  selectedTheme = 'theme-dark';
  showInterviewSummary = false;

  private scoreTotals = {
    theory: 0,
    coding: 0,
    scenario: 0,
    output: 0,
  };
  private scoreEntries = 0;
  private stuckAttemptsForCurrentQuestion = 0;
  
  private themes = [
    { class: 'theme-dark', label: 'Night' },
    { class: 'theme-sky', label: 'Sky' },
    { class: 'theme-lavender', label: 'Lavender' },
    { class: 'theme-sage', label: 'Sage' },
    { class: 'theme-rose', label: 'Rose' },
    { class: 'theme-forest', label: 'Forest' },
    { class: 'theme-light', label: 'Light' }
  ];
  currentThemeIndex = 0;
  showWelcomeScreen = true;

  constructor(private http: HttpClient, private ngZone: NgZone) { }

  get canAnswerNow(): boolean {
    return this.interviewStarted && this.isAnswerTurn && !this.isAwaitingResponse && !this.showRatingStep;
  }

  get isStartDisabled(): boolean {
    return this.interviewStarted || this.showRatingStep || this.isAwaitingResponse;
  }

  get hasSelectionChanges(): boolean {
    return this.level !== 'easy' || this.experience !== '0-1 years' || this.topic !== 'JavaScript';
  }

  get isResetDisabled(): boolean {
    return this.isStartDisabled || !this.hasSelectionChanges;
  }

  get currentThemeName(): string {
    return this.themes[this.currentThemeIndex]?.label || 'Night';
  }

  get hasScoreData(): boolean {
    return this.scoreEntries > 0;
  }

  get theoryAverage(): number {
    return this.getSectionAverage('theory');
  }

  get codingAverage(): number {
    return this.getSectionAverage('coding');
  }

  get scenarioAverage(): number {
    return this.getSectionAverage('scenario');
  }

  get outputAverage(): number {
    return this.getSectionAverage('output');
  }

  get overallAverage(): number {
    if (!this.hasScoreData) return 0;
    const total = this.theoryAverage + this.codingAverage + this.scenarioAverage + this.outputAverage;
    return this.roundScore(total / 4);
  }

  get theoryWidth(): string {
    return `${Math.max(0, Math.min(100, this.theoryAverage * 10))}%`;
  }

  get codingWidth(): string {
    return `${Math.max(0, Math.min(100, this.codingAverage * 10))}%`;
  }

  get scenarioWidth(): string {
    return `${Math.max(0, Math.min(100, this.scenarioAverage * 10))}%`;
  }

  get outputWidth(): string {
    return `${Math.max(0, Math.min(100, this.outputAverage * 10))}%`;
  }

  enterPlatform() {
    this.showWelcomeScreen = false;
  }

  cycleThemeNext() {
    this.currentThemeIndex = (this.currentThemeIndex + 1) % this.themes.length;
    this.selectedTheme = this.themes[this.currentThemeIndex].class;
  }

  cycleThemePrev() {
    this.currentThemeIndex = (this.currentThemeIndex - 1 + this.themes.length) % this.themes.length;
    this.selectedTheme = this.themes[this.currentThemeIndex].class;
  }

  startInterview() {
    this.messages = [];
    this.showInterviewSummary = false;
    this.resetScoreSummary();
    this.showRatingStep = true;
    this.selfRating = '';
    this.userInput = '';
    this.interviewStarted = false;
    this.isAnswerTurn = false;
    this.isAwaitingResponse = false;
    this.lastQuestion = '';
    this.stuckAttemptsForCurrentQuestion = 0;
    this.resetAnswerInputHeight();
    this.focusRatingInput();

    // Ask for self-rating first
    this.messages.push(
      this.createMessage(
        'ai',
        'Great! Before we start, I\'d like to know how you rate yourself on a scale of 1-10 on the topic of <strong>' + this.topic + '</strong>. This will help me tailor the questions to your level.<br/><br/>(1 = beginner, 5 = intermediate, 10 = expert)'
      )
    );
  }

  submitSelfRating() {
    if (!this.selfRating || this.selfRating === '') return;
    
    const rating = parseInt(this.selfRating);
    if (rating < 1 || rating > 10) {
      alert('Please enter a rating between 1 and 10');
      return;
    }

    this.messages.push(this.createMessage('user', 'I rate myself as ' + rating + ' out of 10'));
    this.showRatingStep = false;
    this.isAwaitingResponse = true;
    this.isAnswerTurn = false;

    const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/start` : '/chat/start';

    this.http.post<any>(apiUrl, {
      level: this.level,
      experience: this.experience,
      topic: this.topic,
      selfRating: rating,
    }).subscribe({
      next: (res) => {
        const reply = res.reply || 'No response from interviewer.';
        const aiMessage = this.createMessage('ai', marked.parse(reply) as string);
        this.messages.push(aiMessage);
        this.lastQuestion = this.extractQuestion(reply);
        this.interviewStarted = true;
        this.isAwaitingResponse = false;
        this.isAnswerTurn = true;
        this.focusAnswerInput();
        this.scrollToMessageStart(aiMessage.id, 'smooth');
      },
      error: (err) => {
        console.error('API error:', err);
        const aiMessage = this.createMessage('ai', 'Unable to start the interview. Please try again.');
        this.messages.push(aiMessage);
        this.isAwaitingResponse = false;
        this.isAnswerTurn = false;
        this.scrollToMessageStart(aiMessage.id, 'smooth');
      }
    });
  }

  resetSelections() {
    this.level = 'easy';
    this.experience = '0-1 years';
    this.topic = 'JavaScript';
  }

  endInterview() {
    if (!this.interviewStarted) return;

    this.interviewStarted = false;
    this.isAnswerTurn = false;
    this.isAwaitingResponse = false;
    this.showRatingStep = false;
    this.showInterviewSummary = true;
  }

  private createMessage(role: 'ai' | 'user', text: string) {
    return {
      id: ++this.messageIdCounter,
      role,
      text,
    };
  }

  extractQuestion(reply: string) {
    const questionMatch = reply.match(/(?:Question:|Q:)([\s\S]*)/i);
    if (questionMatch && questionMatch[1]) {
      return questionMatch[1].trim();
    }
    return reply.trim();
  }

  private roundScore(score: number): number {
    return Math.round(score * 10) / 10;
  }

  private getSectionAverage(section: 'theory' | 'coding' | 'scenario' | 'output'): number {
    if (!this.hasScoreData) return 0;
    return this.roundScore(this.scoreTotals[section] / this.scoreEntries);
  }

  private resetScoreSummary() {
    this.scoreTotals = {
      theory: 0,
      coding: 0,
      scenario: 0,
      output: 0,
    };
    this.scoreEntries = 0;
  }

  private extractSectionRatings(reply: string): string {
    const ratingsRegex = /Section ratings\s*\(\/10\)\s*:\s*Theory\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Coding\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Scenario\s*:\s*(10|\d(?:\.\d+)?)\s*\|\s*Output\s*:\s*(10|\d(?:\.\d+)?)/i;
    const match = reply.match(ratingsRegex);

    if (match) {
      const theory = Number.parseFloat(match[1]);
      const coding = Number.parseFloat(match[2]);
      const scenario = Number.parseFloat(match[3]);
      const output = Number.parseFloat(match[4]);

      const parsedScores = [theory, coding, scenario, output];
      const hasInvalidScore = parsedScores.some((value) => Number.isNaN(value));

      if (!hasInvalidScore) {
        this.scoreTotals.theory += Math.max(0, Math.min(10, theory));
        this.scoreTotals.coding += Math.max(0, Math.min(10, coding));
        this.scoreTotals.scenario += Math.max(0, Math.min(10, scenario));
        this.scoreTotals.output += Math.max(0, Math.min(10, output));
        this.scoreEntries += 1;
      }
    }

    return reply
      .replace(ratingsRegex, '')
      .replace(/^.*Section\s*ratings.*$/gim, '')
      .replace(/^.*Ratings\s+are\s+based\s+on.*$/gim, '')
      .replace(/^\s*\(\s*Note\s*:\s*Ratings.*\)\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private normalizeInterviewerTone(reply: string): string {
    return reply
      .replace(/\byour\s+message\b/gi, 'that response')
      .replace(/\byour\s+response\s+was\b/gi, 'that was')
      .replace(/\byou\s+said\b/gi, 'from what I heard')
      .replace(/\blet'?s\s+focus\s+on\b/gi, 'let us focus on')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private detectResponseSignal(message: string): 'normal' | 'dont_know' | 'move_on' | 'greeting' {
    const normalized = message.toLowerCase().trim();
    const cleaned = normalized.replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();

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
      'idk',
      "can't answer",
      'cannot answer',
      'i am not sure',
      "i'm not sure",
    ];

    if (moveOnPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'move_on';
    }

    if (dontKnowPhrases.some((phrase) => normalized.includes(phrase))) {
      return 'dont_know';
    }

    const greetingOnlyRegex = /^(?:(?:hi|hello|hey|hola|good morning|good afternoon|good evening)(?:\s+(?:hi|hello|hey|there|team|all|everyone|sir|madam|mam))*)$/i;
    if (cleaned.length > 0 && cleaned.split(' ').length <= 6 && greetingOnlyRegex.test(cleaned)) {
      return 'greeting';
    }

    return 'normal';
  }

  onAnswerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;

    // GPT-like behavior: Enter sends, Shift+Enter inserts newline.
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  autoResizeAnswer(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    if (!textarea) return;

    const maxHeight = 220;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  resetAnswerInputHeight() {
    const textarea = this.answerInput?.nativeElement;
    if (!textarea) return;

    textarea.style.height = '';
    textarea.style.overflowY = 'hidden';
  }

  private focusAnswerInput() {
    this.pendingAnswerFocus = true;

    const textarea = this.answerInput?.nativeElement;
    if (!textarea) return;

    // Production builds can reorder/optimize rendering timing; wait for a stable frame.
    this.ngZone.onStable.pipe(take(1)).subscribe(() => {
      this.tryFocusAnswerInput(6);
    });
  }

  private tryFocusAnswerInput(retries: number) {
    const textarea = this.answerInput?.nativeElement;
    if (!textarea || !this.canAnswerNow) return;

    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);

    if (document.activeElement === textarea) {
      this.pendingAnswerFocus = false;
      return;
    }

    if (retries > 0) {
      requestAnimationFrame(() => this.tryFocusAnswerInput(retries - 1));
    }
  }

  private focusRatingInput() {
    this.pendingRatingFocus = true;

    const input = this.ratingInput?.nativeElement;
    if (!input) return;

    setTimeout(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
      this.pendingRatingFocus = false;
    }, 0);
  }

  private getChatContainer(): HTMLElement | null {
    return document.querySelector('.chat-messages') as HTMLElement | null;
  }

  private scrollToMessageStart(messageId: number, behavior: ScrollBehavior = 'smooth', attempts = 6) {
    const container = this.getChatContainer();
    if (!container) return;

    setTimeout(() => {
      const target = container.querySelector(`.message[data-message-id="${messageId}"]`) as HTMLElement | null;

      if (!target) {
        if (attempts > 0) {
          this.scrollToMessageStart(messageId, behavior, attempts - 1);
        } else {
          this.scrollToBottom(behavior);
        }
        return;
      }

      const topOffset = target.offsetTop - 24;
      container.scrollTo({
        top: Math.max(0, topOffset),
        behavior,
      });
    }, 0);
  }

  sendMessage() {
    if (!this.userInput.trim() || !this.canAnswerNow) return;
    if (!this.interviewStarted) {
      this.startInterview();
      return;
    }

    const answer = this.userInput;
    this.messages.push(this.createMessage('user', answer));
    this.userInput = '';
    this.resetAnswerInputHeight();
    this.isAnswerTurn = false;
    this.isAwaitingResponse = true;
    this.scrollToBottom('smooth');

    const responseSignal = this.detectResponseSignal(answer);
    if (responseSignal === 'dont_know' || responseSignal === 'move_on') {
      this.stuckAttemptsForCurrentQuestion += 1;
    } else {
      this.stuckAttemptsForCurrentQuestion = 0;
    }

    const previousQuestion = this.lastQuestion;

    const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/answer` : '/chat/answer';
    this.http.post<any>(apiUrl, {
      answer,
      question: this.lastQuestion,
      level: this.level,
      experience: this.experience,
      topic: this.topic,
      responseSignal,
      stuckAttempts: this.stuckAttemptsForCurrentQuestion,
    }).subscribe({
      next: (res) => {
        const rawReply = res.reply || 'No response from interviewer.';
        const noRatingsReply = this.extractSectionRatings(rawReply);
        const cleanedReply = this.normalizeInterviewerTone(noRatingsReply) || 'No response from interviewer.';
        const aiMessage = this.createMessage('ai', marked.parse(cleanedReply) as string);
        this.messages.push(aiMessage);
        this.lastQuestion = this.extractQuestion(cleanedReply);
        if (this.lastQuestion !== previousQuestion) {
          this.stuckAttemptsForCurrentQuestion = 0;
        }
        this.isAwaitingResponse = false;
        this.isAnswerTurn = true;
        this.focusAnswerInput();
        this.scrollToMessageStart(aiMessage.id, 'smooth');
      },
      error: (err) => {
        console.error('API error:', err);
        const aiMessage = this.createMessage('ai', 'Error evaluating answer. Please try again.');
        this.messages.push(aiMessage);
        this.isAwaitingResponse = false;
        this.isAnswerTurn = true;
        this.focusAnswerInput();
        this.scrollToMessageStart(aiMessage.id, 'smooth');
      }
    });
  }

  ngAfterViewChecked() {
    if (this.pendingRatingFocus && this.showRatingStep) {
      const input = this.ratingInput?.nativeElement;
      if (input) {
        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
        this.pendingRatingFocus = false;
      }
    }

    if (this.pendingAnswerFocus && this.canAnswerNow) {
      this.tryFocusAnswerInput(4);
    }

    this.checkScroll();
  }

  checkScroll() {
    const container = document.querySelector('.chat-messages') as HTMLElement;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      this.showScrollButton = !isNearBottom && container.scrollHeight > container.clientHeight;
    }
  }

  scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const container = this.getChatContainer();
    if (container) {
      setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior,
        });
      }, 0);
    }
  }
}
