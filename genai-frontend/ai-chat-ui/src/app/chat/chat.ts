import { Component, AfterViewChecked, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
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

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css']
})
export class Chat implements AfterViewChecked, OnDestroy {

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('ratingInput') ratingInput?: ElementRef<HTMLTextAreaElement | HTMLInputElement>;

  private apiBaseUrl = ((environment as any).apiBaseUrl || (environment as any).apiUrl || '').replace(/\/+$/, '') || '';
  private readonly ratingRangeValidationMessage = 'You can respond only in between 1 to 10.';
  private readonly thinkingDurationSeconds = 30;
  private readonly maxVoiceAnswerSeconds = 120;
  private readonly silenceTimeoutMs = 3000;
  private readonly initialSpeechTimeoutMs = 8000;
  private readonly fillerWords = ['umm', 'um', 'uh', 'like', 'you know', 'actually', 'basically', 'literally'];

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
  voiceModeEnabled = true;
  questionVoiceEnabled = true;
  speechSupported = false;
  ttsSupported = false;
  isThinking = false;
  thinkSecondsLeft = 0;
  isRecording = false;
  recordSecondsLeft = 0;
  isSpeakingQuestion = false;
  isVoiceStripVisible = false;
  micPermissionState: 'unknown' | 'prompt' | 'granted' | 'denied' = 'unknown';
  voiceErrorMessage = '';
  isAnswerMultiline = false;
  transcriptLive = '';
  transcriptFinal = '';
  transcriptHighlightHtml = '';
  transcriptTips: string[] = [];
  waveLevels: number[] = Array.from({ length: 84 }, () => 0.08);
  isRatingVoiceListening = false;
  isRatingVoiceStripVisible = false;
  private ratingVoicePendingSubmit = false;
  private ratingSpeechFinal = '';
  private ratingSpeechLive = '';
  private ratingVoiceRecognition: SpeechRecognitionLike | null = null;

  private recognition: SpeechRecognitionLike | null = null;
  private pendingVoiceSubmit = false;
  private stopRequested = false;
  private thinkingIntervalId: ReturnType<typeof setInterval> | null = null;
  private recordingIntervalId: ReturnType<typeof setInterval> | null = null;
  private silenceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private initialSpeechTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private speechStartTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private visualizerIntervalId: ReturnType<typeof setInterval> | null = null;
  private recordingSessionActive = false;
  private hasSpeechInCurrentRecording = false;
  private voiceSubmitLocked = false;
  private visualizerStream: MediaStream | null = null;
  private visualizerAudioContext: AudioContext | null = null;
  private visualizerAnalyser: AnalyserNode | null = null;
  private visualizerData: Uint8Array<ArrayBuffer> | null = null;

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

  constructor(private http: HttpClient, private ngZone: NgZone) {
    this.initializeVoiceSupport();
  }

  toggleQuestionVoice() {
    this.questionVoiceEnabled = !this.questionVoiceEnabled;
    if (!this.questionVoiceEnabled) {
      this.stopInterviewerSpeech();
    }
  }

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

  get hasRatingText(): boolean {
    return !!this.selfRating && this.selfRating.trim().length > 0;
  }

  get hasAnswerText(): boolean {
    return !!this.userInput && this.userInput.trim().length > 0;
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
    this.stopInterviewerSpeech();
    this.stopRatingVoiceCapture();
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
    this.voiceErrorMessage = '';
    this.resetVoiceRuntime();
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
    this.stopInterviewerSpeech();
    this.stopRatingVoiceCapture();

    if (!this.selfRating || this.selfRating.trim() === '') {
      this.ratingValidationMessage = 'Please enter your rating before submitting.';
      return;
    }
    
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
        this.speakQuestionWithDelay(message);
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

  toggleRatingVoiceCapture() {
    if (!this.speechSupported || this.isAwaitingResponse) return;
    if (this.isRatingVoiceListening) {
      this.stopRatingVoiceCapture(false);
      return;
    }

    this.isRatingVoiceStripVisible = true;
    this.startRatingVoiceCapture();
  }

  private startRatingVoiceCapture() {
    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!speechCtor) return;

    this.stopRatingVoiceCapture(false);
    this.ratingValidationMessage = '';
    this.ratingVoicePendingSubmit = false;
    this.ratingSpeechFinal = '';
    this.ratingSpeechLive = '';

    const recognition = new speechCtor() as SpeechRecognitionLike;
    this.ratingVoiceRecognition = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.ngZone.run(() => {
        this.isRatingVoiceListening = true;
        this.isRatingVoiceStripVisible = true;
      });
      void this.startAudioVisualizer();
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      this.ngZone.run(() => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const chunk = (result[0]?.transcript || '').trim();
          if (!chunk) continue;
          if (result.isFinal) {
            finalChunk += `${chunk} `;
          } else {
            interim += `${chunk} `;
          }
        }

        if (finalChunk) {
          this.ratingSpeechFinal = `${this.ratingSpeechFinal} ${finalChunk}`.trim();
        }

        this.ratingSpeechLive = interim.trim();
        const fullTranscript = `${this.ratingSpeechFinal} ${this.ratingSpeechLive}`.trim();
        const parsed = this.extractRatingFromSpeech(fullTranscript);
        if (parsed !== null) {
          this.selfRating = String(parsed);
          this.ratingValidationMessage = '';
        }
      });
    };

    recognition.onerror = () => {
      this.ngZone.run(() => {
        this.isRatingVoiceListening = false;
        this.isRatingVoiceStripVisible = false;
        this.ratingVoicePendingSubmit = false;
        this.stopAudioVisualizer();
        if (!this.selfRating.trim()) {
          this.ratingValidationMessage = 'Voice input failed. Please say a rating between 1 and 10.';
        }
        this.ratingVoiceRecognition = null;
      });
    };

    recognition.onend = () => {
      this.ngZone.run(() => {
        const shouldSubmit = this.ratingVoicePendingSubmit;
        this.isRatingVoiceListening = false;
        this.isRatingVoiceStripVisible = false;
        this.ratingVoicePendingSubmit = false;
        this.stopAudioVisualizer();
        this.ratingVoiceRecognition = null;

        if (shouldSubmit) {
          const fullTranscript = `${this.ratingSpeechFinal} ${this.ratingSpeechLive}`.trim();
          const parsed = this.extractRatingFromSpeech(fullTranscript);
          if (parsed !== null) {
            this.selfRating = String(parsed);
          }

          if (this.selfRating.trim()) {
            this.submitSelfRating();
          } else {
            this.ratingValidationMessage = 'Could not detect a rating. Say a number between 1 and 10.';
          }
        }
      });
    };

    try {
      recognition.start();
    } catch {
      this.isRatingVoiceListening = false;
      this.isRatingVoiceStripVisible = false;
      this.ratingVoicePendingSubmit = false;
    }
  }

  cancelRatingVoiceCapture() {
    this.isRatingVoiceStripVisible = false;
    this.ratingSpeechFinal = '';
    this.ratingSpeechLive = '';
    this.stopRatingVoiceCapture(false);
  }

  submitRatingVoiceCapture() {
    if (this.isRatingVoiceListening) {
      this.stopRatingVoiceCapture(true);
      return;
    }

    if (this.selfRating.trim()) {
      this.submitSelfRating();
      return;
    }

    this.ratingValidationMessage = 'Could not detect a rating. Say a number between 1 and 10.';
  }

  private stopRatingVoiceCapture(submit = false) {
    if (!this.ratingVoiceRecognition) {
      if (submit && this.selfRating.trim()) {
        this.submitSelfRating();
      }
      return;
    }

    this.ratingVoicePendingSubmit = submit;
    try {
      this.ratingVoiceRecognition.stop();
    } catch {
      this.isRatingVoiceListening = false;
      this.isRatingVoiceStripVisible = false;
      this.ratingVoicePendingSubmit = false;
      this.ratingSpeechFinal = '';
      this.ratingSpeechLive = '';
      this.stopAudioVisualizer();
      this.ratingVoiceRecognition = null;
    }
  }

  private extractRatingFromSpeech(transcript: string): number | null {
    const normalized = (transcript || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    const numericMatch = normalized.match(/\b(10|[1-9])\b/);
    if (numericMatch) {
      const numeric = Number.parseInt(numericMatch[1], 10);
      if (numeric >= 1 && numeric <= 10) return numeric;
    }

    const map: Record<string, number> = {
      one: 1,
      won: 1,
      two: 2,
      to: 2,
      too: 2,
      three: 3,
      four: 4,
      for: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      ate: 8,
      nine: 9,
      ten: 10,
    };

    for (const [word, value] of Object.entries(map)) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(normalized)) {
        return value;
      }
    }

    return null;
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

    this.stopInterviewerSpeech();
    this.cancelVoiceActivities();

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
    this.stopRatingVoiceCapture();
    this.cancelVoiceActivities();
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
    this.voiceErrorMessage = '';
    this.transcriptLive = '';
    this.transcriptFinal = '';
    this.transcriptHighlightHtml = '';
    this.transcriptTips = [];
    this.resetSelections();
    this.resetScoreSummary();
    this.resetAnswerInputHeight();
  }

  ngOnDestroy() {
    this.stopRatingVoiceCapture();
    this.cancelVoiceActivities();
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

    if (textarea.value.trim().length > 0 && this.voiceErrorMessage) {
      this.voiceErrorMessage = '';
    }

    this.applyAnswerTextareaSizing(textarea);
    this.updateAnswerMultilineState(textarea);
  }

  resetAnswerInputHeight() {
    const textarea = this.answerInput?.nativeElement;
    if (!textarea) {
      this.isAnswerMultiline = false;
      return;
    }

    textarea.style.height = '';
    textarea.style.overflowY = 'hidden';
    this.isAnswerMultiline = false;
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
    this.stopInterviewerSpeech();
    this.sendMessageInternal(false);
  }

  startRecordingImmediately() {
    if (!this.voiceModeEnabled || !this.canAnswerNow || this.isAwaitingResponse || this.isRecording) return;

    this.isVoiceStripVisible = true;
    this.clearThinkingTimer();
    this.isThinking = false;
    this.thinkSecondsLeft = 0;
    this.voiceErrorMessage = '';
    this.transcriptFinal = '';
    this.transcriptLive = '';
    this.userInput = '';
    void this.startRecordingFlow();
  }

  onInlineMicClick() {
    this.stopInterviewerSpeech();
    if (!this.voiceModeEnabled || !this.canAnswerNow || this.isAwaitingResponse) return;

    if (this.isRecording) {
      this.stopRecording(true);
      return;
    }

    this.startRecordingImmediately();
  }

  cancelVoiceCapture() {
    this.stopInterviewerSpeech();
    this.isVoiceStripVisible = false;

    if (this.isThinking) {
      this.clearThinkingTimer();
      this.isThinking = false;
      this.thinkSecondsLeft = 0;
    }

    if (this.isRecording) {
      this.stopRecording(false);
    }

    this.transcriptLive = '';
    this.transcriptFinal = '';
    this.userInput = '';
    this.voiceErrorMessage = '';
  }

  submitVoiceCapture() {
    this.stopInterviewerSpeech();
    if (this.voiceSubmitLocked || this.pendingVoiceSubmit || this.isAwaitingResponse) return;

    if (this.isThinking) {
      this.startRecordingImmediately();
      return;
    }

    if (this.isRecording) {
      this.isVoiceStripVisible = false;
      this.stopRecording(true);
      return;
    }

    if (this.userInput.trim() && this.canAnswerNow) {
      this.isVoiceStripVisible = false;
      this.sendMessageInternal(true);
    }
  }

  private sendMessageInternal(fromVoice: boolean) {
    if (!this.userInput.trim() || !this.canAnswerNow) return;
    if (this.isRecording) return;
    if (!this.interviewStarted) {
      this.startInterview();
      return;
    }

    const answer = this.userInput;
    if (fromVoice) {
      this.isVoiceStripVisible = false;
      this.voiceSubmitLocked = false;
      this.transcriptFinal = answer;
      this.analyzeTranscript(answer);
    }

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
        this.speakQuestionWithDelay(message);

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

  private initializeVoiceSupport() {
    if (typeof window === 'undefined') return;

    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.speechSupported = !!speechCtor;
    this.ttsSupported = 'speechSynthesis' in window;

    if (!this.speechSupported) {
      this.voiceModeEnabled = false;
      this.voiceErrorMessage = 'Voice input is not supported in this browser. Use Chrome or Edge for full support.';
    }

    if (this.ttsSupported) this.stopInterviewerSpeech();
  }

  private startThinkingCountdown() {
    this.isThinking = true;
    this.thinkSecondsLeft = this.thinkingDurationSeconds;
    this.clearThinkingTimer();
    this.thinkingIntervalId = setInterval(() => {
      this.thinkSecondsLeft -= 1;
      if (this.thinkSecondsLeft <= 0) {
        this.clearThinkingTimer();
        this.isThinking = false;
        void this.startRecordingFlow();
      }
    }, 1000);
  }

  private async startRecordingFlow() {
    const hasPermission = await this.ensureMicrophonePermission();
    if (!hasPermission) {
      this.voiceErrorMessage = 'Microphone permission is required for Answer Now mode.';
      return;
    }

    this.stopInterviewerSpeech();

    this.startRecording();
  }

  private async ensureMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.micPermissionState = 'denied';
      return false;
    }

    try {
      if ((navigator as any).permissions?.query) {
        const status = await (navigator as any).permissions.query({ name: 'microphone' });
        if (status.state === 'granted') {
          this.micPermissionState = 'granted';
          return true;
        }

        if (status.state === 'denied') {
          this.micPermissionState = 'denied';
          return false;
        }

        this.micPermissionState = 'prompt';
      }
    } catch {
      // Some browsers throw for microphone permission query.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      this.micPermissionState = 'granted';
      return true;
    } catch {
      this.micPermissionState = 'denied';
      return false;
    }
  }

  private startRecording() {
    if (!this.speechSupported) {
      this.voiceErrorMessage = 'Voice input is not supported in this browser.';
      return;
    }

    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new speechCtor() as SpeechRecognitionLike;
    this.recognition = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    this.stopRequested = false;
    this.pendingVoiceSubmit = false;
    this.recordingSessionActive = true;
    this.hasSpeechInCurrentRecording = false;
    this.transcriptFinal = '';
    this.transcriptLive = '';
    this.recordSecondsLeft = this.maxVoiceAnswerSeconds;

    recognition.onstart = () => {
      this.ngZone.run(() => {
        this.isRecording = true;
        this.isVoiceStripVisible = true;
        this.voiceErrorMessage = '';
        this.startRecordingTimer();
        this.startInitialSpeechTimeout();
      });
      void this.startAudioVisualizer();
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      this.ngZone.run(() => {
        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = (result[0]?.transcript || '').trim();
          if (!transcript) continue;

          if (result.isFinal) {
            finalChunk += `${transcript} `;
          } else {
            interim += `${transcript} `;
          }
        }

        if (finalChunk) {
          const combinedFinal = `${this.transcriptFinal} ${finalChunk}`.trim();
          this.transcriptFinal = combinedFinal;
        }

        if ((finalChunk || interim) && !this.hasSpeechInCurrentRecording) {
          this.hasSpeechInCurrentRecording = true;
        }

        this.transcriptLive = interim.trim();
        const composed = `${this.transcriptFinal} ${this.transcriptLive}`.trim();
        this.userInput = composed;
        this.autoResizeCurrentAnswerInput();
        this.clearInitialSpeechTimeout();
        this.restartSilenceTimeout();
      });
    };

    recognition.onerror = (event: any) => {
      this.ngZone.run(() => {
        const code = event?.error || 'unknown';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.micPermissionState = 'denied';
          this.voiceErrorMessage = 'Microphone access was denied. Please allow permission and try again.';
        } else if (code !== 'aborted') {
          this.voiceErrorMessage = 'Voice capture interrupted. Please try Answer Now again.';
        }
      });
    };

    recognition.onend = () => {
      this.ngZone.run(() => {
        this.clearRecordingTimer();
        this.clearSilenceTimeout();
        this.clearInitialSpeechTimeout();
        this.stopAudioVisualizer();
        this.isRecording = false;

        if (this.pendingVoiceSubmit) {
          const composedTranscript = `${this.transcriptFinal} ${this.transcriptLive}`.trim();
          const composed = composedTranscript || this.userInput.trim();
          this.pendingVoiceSubmit = false;
          this.recordingSessionActive = false;

          if (composed && this.canAnswerNow) {
            this.userInput = composed;
            this.sendMessageInternal(true);
          } else {
            this.voiceErrorMessage = 'No speech captured. Tap mic and speak again.';
            this.voiceSubmitLocked = false;
          }
          return;
        }

        if (this.stopRequested) {
          this.stopRequested = false;
          this.recordingSessionActive = false;
          this.pendingVoiceSubmit = false;
          this.voiceSubmitLocked = false;
          return;
        }

        if (this.recordingSessionActive && this.userInput.trim() && this.canAnswerNow) {
          this.recordingSessionActive = false;
          this.sendMessageInternal(true);
          return;
        }

        if (this.recordingSessionActive) {
          this.recordingSessionActive = false;
          this.voiceErrorMessage = this.hasSpeechInCurrentRecording
            ? 'Voice capture ended before submit. Tap mic and try again.'
            : 'No clear speech detected. Start speaking right after tapping the mic.';
        }
      });
    };

    try {
      recognition.start();
    } catch {
      this.voiceErrorMessage = 'Unable to start voice recording. Please try again.';
    }
  }

  private stopRecording(submit: boolean) {
    if (!this.recognition) return;

    if (submit && (this.pendingVoiceSubmit || this.voiceSubmitLocked)) return;

    if (submit) this.voiceSubmitLocked = true;
    this.pendingVoiceSubmit = submit;
    this.stopRequested = true;
    this.clearSilenceTimeout();

    try {
      this.recognition.stop();
    } catch {
      this.isRecording = false;
    }
  }

  private startRecordingTimer() {
    this.clearRecordingTimer();
    this.recordingIntervalId = setInterval(() => {
      this.recordSecondsLeft -= 1;
      if (this.recordSecondsLeft <= 0) {
        this.recordSecondsLeft = 0;
        this.stopRecording(true);
      }
    }, 1000);
  }

  private restartSilenceTimeout() {
    this.clearSilenceTimeout();
    this.silenceTimeoutId = setTimeout(() => {
      this.stopRecording(true);
    }, this.silenceTimeoutMs);
  }

  private startInitialSpeechTimeout() {
    this.clearInitialSpeechTimeout();
    this.initialSpeechTimeoutId = setTimeout(() => {
      if (!this.hasSpeechInCurrentRecording) {
        this.stopRecording(false);
      }
    }, this.initialSpeechTimeoutMs);
  }

  private clearThinkingTimer() {
    if (!this.thinkingIntervalId) return;
    clearInterval(this.thinkingIntervalId);
    this.thinkingIntervalId = null;
  }

  private clearRecordingTimer() {
    if (!this.recordingIntervalId) return;
    clearInterval(this.recordingIntervalId);
    this.recordingIntervalId = null;
  }

  private clearSilenceTimeout() {
    if (!this.silenceTimeoutId) return;
    clearTimeout(this.silenceTimeoutId);
    this.silenceTimeoutId = null;
  }

  private clearInitialSpeechTimeout() {
    if (!this.initialSpeechTimeoutId) return;
    clearTimeout(this.initialSpeechTimeoutId);
    this.initialSpeechTimeoutId = null;
  }

  private async startAudioVisualizer() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    if (typeof window === 'undefined') return;

    try {
      this.stopAudioVisualizer();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.visualizerStream = stream;
      const audioContext = new AudioCtx() as AudioContext;
      this.visualizerAudioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      this.visualizerAnalyser = analyser;
      analyser.fftSize = 128;
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.visualizerData = data;
      source.connect(analyser);

      this.visualizerIntervalId = setInterval(() => {
        if (!this.visualizerAnalyser || !this.visualizerData) return;
        this.visualizerAnalyser.getByteTimeDomainData(this.visualizerData);

        let sumSquares = 0;
        for (let i = 0; i < this.visualizerData.length; i += 1) {
          const normalized = (this.visualizerData[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / this.visualizerData.length);
        const level = Math.max(0.08, Math.min(1.35, rms * 8.8));

        const next = [...this.waveLevels];
        next.pop();
        next.unshift(level);

        this.ngZone.run(() => {
          this.waveLevels = next;
        });
      }, 70);
    } catch {
      // Visualizer is optional; speech recognition should continue even if this fails.
    }
  }

  private stopAudioVisualizer() {
    if (this.visualizerIntervalId) {
      clearInterval(this.visualizerIntervalId);
      this.visualizerIntervalId = null;
    }

    if (this.visualizerStream) {
      this.visualizerStream.getTracks().forEach((track) => track.stop());
      this.visualizerStream = null;
    }

    if (this.visualizerAudioContext) {
      void this.visualizerAudioContext.close();
      this.visualizerAudioContext = null;
    }

    this.visualizerAnalyser = null;
    this.visualizerData = null;
    this.waveLevels = Array.from({ length: 84 }, () => 0.08);
  }

  private resetVoiceRuntime() {
    this.clearThinkingTimer();
    this.clearRecordingTimer();
    this.clearSilenceTimeout();
    this.clearInitialSpeechTimeout();
    this.stopAudioVisualizer();
    this.thinkSecondsLeft = 0;
    this.recordSecondsLeft = 0;
    this.isThinking = false;
    this.isRecording = false;
    this.isVoiceStripVisible = false;
    this.pendingVoiceSubmit = false;
    this.stopRequested = false;
    this.recordingSessionActive = false;
    this.hasSpeechInCurrentRecording = false;
    this.voiceSubmitLocked = false;
    this.transcriptLive = '';
    this.transcriptFinal = '';
  }

  private cancelVoiceActivities() {
    this.resetVoiceRuntime();

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // Ignore stop failures during teardown.
      }
      this.recognition = null;
    }

    this.stopInterviewerSpeech();
  }

  private applyAnswerTextareaSizing(textarea: HTMLTextAreaElement) {
    const maxHeight = 220;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  private stopInterviewerSpeech() {
    if (this.speechStartTimeoutId) {
      clearTimeout(this.speechStartTimeoutId);
      this.speechStartTimeoutId = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    this.isSpeakingQuestion = false;
  }

  private autoResizeCurrentAnswerInput() {
    const textarea = this.answerInput?.nativeElement;
    if (!textarea) return;

    this.applyAnswerTextareaSizing(textarea);
    this.updateAnswerMultilineState(textarea);
  }

  private updateAnswerMultilineState(textarea: HTMLTextAreaElement) {
    const hasNewLine = (textarea.value || '').includes('\n');
    const wrapsToMultipleLines = textarea.scrollHeight > 44;
    this.isAnswerMultiline = hasNewLine || wrapsToMultipleLines;
  }

  private speakQuestionWithDelay(rawText: string) {
    if (!this.questionVoiceEnabled || !this.ttsSupported || !rawText || typeof window === 'undefined') {
      return;
    }

    const speechText = this.normalizeSpeechText(rawText);
    if (!speechText) return;

    if (this.speechStartTimeoutId) {
      clearTimeout(this.speechStartTimeoutId);
    }

    window.speechSynthesis.cancel();
    this.isSpeakingQuestion = true;
    this.speechStartTimeoutId = setTimeout(() => {
      this.speechStartTimeoutId = null;
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.onend = () => {
        this.isSpeakingQuestion = false;
      };
      utterance.onerror = () => {
        this.isSpeakingQuestion = false;
      };
      window.speechSynthesis.speak(utterance);
    }, 700);
  }

  private normalizeSpeechText(input: string): string {
    return (input || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
      .replace(/[\*_#>~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private analyzeTranscript(transcript: string) {
    const clean = (transcript || '').trim();
    if (!clean) return;

    const counts = this.fillerWords
      .map((word) => ({ word, count: this.countOccurrences(clean, word) }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    this.transcriptHighlightHtml = this.highlightFillers(clean);

    if (!counts.length) {
      this.transcriptTips = ['Strong clarity: no common filler words detected in this answer.'];
      return;
    }

    const top = counts.slice(0, 3).map((entry) => `${entry.word} (${entry.count})`).join(', ');
    this.transcriptTips = [
      `Frequent fillers: ${top}.`,
      'Pause for one second before your next sentence instead of using filler words.',
      'Replace fillers with short structure cues like "First", "Then", and "Finally".',
    ];
  }

  private countOccurrences(source: string, phrase: string): number {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
    return source.match(pattern)?.length || 0;
  }

  private highlightFillers(source: string): string {
    let html = this.escapeHtml(source);
    for (const word of this.fillerWords) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b(${escaped})\\b`, 'gi');
      html = html.replace(pattern, '<mark class="filler-word">$1</mark>');
    }
    return html;
  }

  private escapeHtml(source: string): string {
    return source
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
