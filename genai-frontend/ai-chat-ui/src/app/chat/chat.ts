import { Component, AfterViewChecked, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

interface InterviewSummary {
  hasScoreData: boolean;
  entries: number;
  theoryAvg: number;
  codingAvg: number;
  scenarioAvg: number;
  outputAvg: number;
  overallAvg: number;
}

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
  private readonly ratingRangeValidationMessage = 'You can respond only in between 1 to 10.';

  userInput = '';
  level = 'easy';
  experience = '0-1 years';
  topic = 'JavaScript';
  selfRating = '';
  ratingValidationMessage = '';
  showRatingStep = false;
  interviewStarted = false;
  isAnswerTurn = false;
  isAwaitingResponse = false;
  lastQuestion = '';
  sessionId = '';
  messages: any[] = [];
  private messageIdCounter = 0;
  private pendingAnswerFocus = false;
  private pendingRatingFocus = false;
  showScrollButton = false;
  selectedTheme = 'theme-dark';
  showEndSummaryModal = false;
  endNotice = '';

  private summary: InterviewSummary = {
    hasScoreData: false,
    entries: 0,
    theoryAvg: 0,
    codingAvg: 0,
    scenarioAvg: 0,
    outputAvg: 0,
    overallAvg: 0,
  };
  
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

  get isRatingValid(): boolean {
    if (!this.selfRating) return false;
    if (!/^\d+$/.test(this.selfRating.trim())) return false;

    const rating = Number.parseInt(this.selfRating, 10);
    return !Number.isNaN(rating) && rating >= 1 && rating <= 10;
  }

  get isRatingInvalid(): boolean {
    return (!!this.selfRating && !this.isRatingValid) || !!this.ratingValidationMessage;
  }

  get showRatingValidState(): boolean {
    return !!this.selfRating && this.isRatingValid && !this.ratingValidationMessage;
  }

  get isSubmitRatingDisabled(): boolean {
    const hasAnyInput = !!this.selfRating && this.selfRating.trim().length > 0;
    return this.isAwaitingResponse || (hasAnyInput && !this.isRatingValid);
  }

  get currentThemeName(): string {
    return this.themes[this.currentThemeIndex]?.label || 'Night';
  }

  get hasScoreData(): boolean {
    return this.summary.hasScoreData;
  }

  get theoryAverage(): number {
    return this.summary.theoryAvg;
  }

  get codingAverage(): number {
    return this.summary.codingAvg;
  }

  get scenarioAverage(): number {
    return this.summary.scenarioAvg;
  }

  get outputAverage(): number {
    return this.summary.outputAvg;
  }

  get overallAverage(): number {
    return this.summary.overallAvg;
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
    this.showEndSummaryModal = false;
    this.resetScoreSummary();
    this.showRatingStep = true;
    this.selfRating = '';
    this.ratingValidationMessage = '';
    this.userInput = '';
    this.interviewStarted = false;
    this.isAnswerTurn = false;
    this.isAwaitingResponse = false;
    this.lastQuestion = '';
    this.sessionId = '';
    this.endNotice = '';
    this.resetAnswerInputHeight();
    this.focusRatingInput();

    // Ask for self-rating first
    this.messages.push(
      this.createMessage(
        'ai',
        'Great! Before we start, I\'d like to know how you rate yourself on a scale of 1-10 on the topic of <strong>' + this.topic + '</strong>. This will help me tailor the questions to your level.' +
        '<div class="rating-scale-list">' +
        '<div>1 = Beginner</div>' +
        '<div>5 = Intermediate</div>' +
        '<div>10 = Expert</div>' +
        '</div>'
      )
    );
  }

  submitSelfRating() {
    if (!this.selfRating || this.selfRating === '') return;
    
    const rating = parseInt(this.selfRating);
    if (rating < 1 || rating > 10) {
      this.ratingValidationMessage = this.ratingRangeValidationMessage;
      return;
    }

    this.ratingValidationMessage = '';

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
        const message = res.message || res.reply || 'No response from interviewer.';
        const aiMessage = this.createMessage('ai', marked.parse(message) as string);
        this.messages.push(aiMessage);
        this.sessionId = res.sessionId || '';
        this.lastQuestion = res.question || this.extractQuestion(message);
        this.applySummary(res.summary);
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

  onSelfRatingInput(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;

    const digitsOnly = (input.value || '').replace(/\D/g, '');
    if (!digitsOnly) {
      this.selfRating = '';
      input.value = '';
      this.ratingValidationMessage = '';
      return;
    }

    const numeric = Number.parseInt(digitsOnly, 10);
    if (Number.isNaN(numeric)) {
      this.selfRating = '';
      input.value = '';
      this.ratingValidationMessage = this.ratingRangeValidationMessage;
      return;
    }

    this.selfRating = digitsOnly;
    input.value = this.selfRating;

    if (numeric < 1 || numeric > 10) {
      this.ratingValidationMessage = this.ratingRangeValidationMessage;
      return;
    }

    this.ratingValidationMessage = '';
  }

  onSelfRatingKeydown(event: KeyboardEvent) {
    const blockedKeys = ['.', ',', '-', '+', 'e', 'E'];
    if (blockedKeys.includes(event.key)) {
      event.preventDefault();
    }
  }

  resetSelections() {
    this.level = 'easy';
    this.experience = '0-1 years';
    this.topic = 'JavaScript';
  }

  endInterview() {
    if (!this.interviewStarted) return;

    this.isAwaitingResponse = true;
    this.isAnswerTurn = false;

    const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/end` : '/chat/end';
    this.http.post<any>(apiUrl, {
      sessionId: this.sessionId,
    }).subscribe({
      next: (res) => {
        if (res?.summary) {
          this.applySummary(res.summary);
        }

        const endMessage = 'Okay, ending the interview. Here is your summary.';
        const aiMessage = this.createMessage('ai', marked.parse(endMessage) as string);
        this.messages.push(aiMessage);
        this.endNotice = endMessage;

        this.interviewStarted = false;
        this.isAnswerTurn = false;
        this.isAwaitingResponse = false;
        this.showRatingStep = false;
        this.showEndSummaryModal = true;
        this.sessionId = '';
        this.lastQuestion = '';
        this.scrollToMessageStart(aiMessage.id, 'smooth');
      },
      error: () => {
        this.endNotice = 'Okay, ending the interview. Here is your summary.';
        this.interviewStarted = false;
        this.isAnswerTurn = false;
        this.isAwaitingResponse = false;
        this.showRatingStep = false;
        this.showEndSummaryModal = true;
        this.sessionId = '';
        this.lastQuestion = '';
      }
    });
  }

  practiceMore() {
    this.showEndSummaryModal = false;
    this.showRatingStep = false;
    this.interviewStarted = false;
    this.isAnswerTurn = false;
    this.isAwaitingResponse = false;
    this.lastQuestion = '';
    this.sessionId = '';
    this.userInput = '';
    this.selfRating = '';
    this.messages = [];
    this.messageIdCounter = 0;
    this.endNotice = '';
    this.resetSelections();
    this.resetScoreSummary();
    this.resetAnswerInputHeight();
  }

  private isEndInterviewIntent(message: string): boolean {
    const normalized = (message || '').toLowerCase().trim();
    const cleaned = normalized.replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();

    if (!cleaned) return false;

    const explicitPhrases = [
      'end interview',
      'end the interview',
      'stop interview',
      'stop the interview',
      'finish interview',
      'finish the interview',
      'interview is over',
      'interview is done',
      'that is all',
    ];

    if (explicitPhrases.some((phrase) => cleaned.includes(phrase))) {
      return true;
    }

    const patterns = [
      /\b(end|stop|finish|close|quit|terminate)\b\s+(?:this\s+|the\s+)?\b(interview|session)\b/i,
      /\b(end|stop|finish)\b\s+now\b/i,
      /\b(interview|session)\b\s+(?:is\s+)?\b(over|done|finished|ended)\b/i,
    ];

    return patterns.some((pattern) => pattern.test(cleaned));
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

  private resetScoreSummary() {
    this.summary = {
      hasScoreData: false,
      entries: 0,
      theoryAvg: 0,
      codingAvg: 0,
      scenarioAvg: 0,
      outputAvg: 0,
      overallAvg: 0,
    };
  }

  private applySummary(summary: Partial<InterviewSummary> | undefined) {
    if (!summary) return;

    this.summary = {
      hasScoreData: Boolean(summary.hasScoreData),
      entries: Number(summary.entries || 0),
      theoryAvg: this.roundScore(Number(summary.theoryAvg || 0)),
      codingAvg: this.roundScore(Number(summary.codingAvg || 0)),
      scenarioAvg: this.roundScore(Number(summary.scenarioAvg || 0)),
      outputAvg: this.roundScore(Number(summary.outputAvg || 0)),
      overallAvg: this.roundScore(Number(summary.overallAvg || 0)),
    };
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

    if (this.isEndInterviewIntent(answer)) {
      this.userInput = '';
      this.endInterview();
      return;
    }

    const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/answer` : '/chat/answer';
    this.http.post<any>(apiUrl, {
      sessionId: this.sessionId,
      answer,
    }).subscribe({
      next: (res) => {
        if (res?.error) {
          const aiMessage = this.createMessage('ai', res.error);
          this.messages.push(aiMessage);
          this.isAwaitingResponse = false;
          this.isAnswerTurn = false;
          this.scrollToMessageStart(aiMessage.id, 'smooth');
          return;
        }

        const message = res.message || res.reply || 'No response from interviewer.';
        const aiMessage = this.createMessage('ai', marked.parse(message) as string);
        this.messages.push(aiMessage);
        this.lastQuestion = res.question || this.extractQuestion(message);
        this.applySummary(res.summary);

        if (res?.ended) {
          this.endNotice = 'Okay, ending the interview. Here is your summary.';
          this.interviewStarted = false;
          this.isAwaitingResponse = false;
          this.isAnswerTurn = false;
          this.showEndSummaryModal = true;
          this.sessionId = '';
          this.lastQuestion = '';
          this.scrollToMessageStart(aiMessage.id, 'smooth');
          return;
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
