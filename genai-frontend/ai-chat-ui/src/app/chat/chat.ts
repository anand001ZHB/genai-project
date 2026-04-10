import { Component, AfterViewChecked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
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

  constructor(private http: HttpClient) { }

  get canAnswerNow(): boolean {
    return this.interviewStarted && this.isAnswerTurn && !this.isAwaitingResponse && !this.showRatingStep;
  }

  get currentThemeName(): string {
    return this.themes[this.currentThemeIndex]?.label || 'Night';
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
    this.showRatingStep = true;
    this.selfRating = '';
    this.userInput = '';
    this.interviewStarted = false;
    this.isAnswerTurn = false;
    this.isAwaitingResponse = false;
    this.lastQuestion = '';
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

  isCasualMessage(message: string): boolean {
    const casual = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay', 'yes', 'no', 'sure', 'got it', 'understood', 'cool', 'nice', 'good', 'bad', 'great', 'wow', 'hmm', 'wait', 'what', 'why', 'how', 'who', 'where', 'when'];
    const lowerMsg = message.toLowerCase().trim();
    return casual.includes(lowerMsg) || lowerMsg.length < 5;
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

    setTimeout(() => {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      this.pendingAnswerFocus = false;
    }, 0);
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

    // Check if this is a casual message or a full answer
    if (this.isCasualMessage(answer)) {
      // Send to casual chat endpoint
      const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/casual` : '/chat/casual';
      this.http.post<any>(apiUrl, { message: answer }).subscribe({
        next: (res) => {
          const reply = res.reply || 'Got it!';
          const aiMessage = this.createMessage('ai', marked.parse(reply) as string);
          this.messages.push(aiMessage);
          this.isAwaitingResponse = false;
          this.isAnswerTurn = true;
          this.focusAnswerInput();
          this.scrollToMessageStart(aiMessage.id, 'smooth');
        },
        error: (err) => {
          console.error('API error:', err);
          const aiMessage = this.createMessage('ai', 'Sorry, something went wrong.');
          this.messages.push(aiMessage);
          this.isAwaitingResponse = false;
          this.isAnswerTurn = true;
          this.focusAnswerInput();
          this.scrollToMessageStart(aiMessage.id, 'smooth');
        }
      });
    } else {
      // Send to interview answer evaluation
      const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/answer` : '/chat/answer';
      this.http.post<any>(apiUrl, {
        answer,
        question: this.lastQuestion,
        level: this.level,
        experience: this.experience,
        topic: this.topic,
      }).subscribe({
        next: (res) => {
          const reply = res.reply || 'No response from interviewer.';
          const aiMessage = this.createMessage('ai', marked.parse(reply) as string);
          this.messages.push(aiMessage);
          this.lastQuestion = this.extractQuestion(reply);
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
      const textarea = this.answerInput?.nativeElement;
      if (textarea) {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
        this.pendingAnswerFocus = false;
      }
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
