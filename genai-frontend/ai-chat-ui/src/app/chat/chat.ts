import { Component, AfterViewChecked } from '@angular/core';
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

  private apiBaseUrl = ((environment as any).apiBaseUrl || (environment as any).apiUrl || '').replace(/\/+$/, '') || '';

  userInput = '';
  level = 'easy';
  experience = '0-1 years';
  topic = 'JavaScript';
  selfRating = '';
  showRatingStep = false;
  interviewStarted = false;
  lastQuestion = '';
  messages: any[] = [];
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
    this.lastQuestion = '';

    // Ask for self-rating first
    this.messages.push({ 
      role: 'ai', 
      text: 'Great! Before we start, I\'d like to know how you rate yourself on a scale of 1-10 on the topic of <strong>' + this.topic + '</strong>. This will help me tailor the questions to your level.<br/><br/>(1 = beginner, 5 = intermediate, 10 = expert)' 
    });
  }

  submitSelfRating() {
    if (!this.selfRating || this.selfRating === '') return;
    
    const rating = parseInt(this.selfRating);
    if (rating < 1 || rating > 10) {
      alert('Please enter a rating between 1 and 10');
      return;
    }

    this.messages.push({ role: 'user', text: 'I rate myself as ' + rating + ' out of 10' });
    this.showRatingStep = false;

    const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/start` : '/chat/start';

    this.http.post<any>(apiUrl, {
      level: this.level,
      experience: this.experience,
      topic: this.topic,
      selfRating: rating,
    }).subscribe({
      next: (res) => {
        const reply = res.reply || 'No response from interviewer.';
        this.messages.push({ role: 'ai', text: marked.parse(reply) });
        this.lastQuestion = this.extractQuestion(reply);
        this.interviewStarted = true;
      },
      error: (err) => {
        console.error('API error:', err);
        this.messages.push({ role: 'ai', text: 'Unable to start the interview. Please try again.' });
      }
    });
  }

  resetSelections() {
    this.level = 'easy';
    this.experience = '0-1 years';
    this.topic = 'JavaScript';
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

  sendMessage() {
    if (!this.userInput.trim()) return;
    if (!this.interviewStarted) {
      this.startInterview();
      return;
    }

    const answer = this.userInput;
    this.messages.push({ role: 'user', text: answer });
    this.userInput = '';

    // Check if this is a casual message or a full answer
    if (this.isCasualMessage(answer)) {
      // Send to casual chat endpoint
      const apiUrl = this.apiBaseUrl ? `${this.apiBaseUrl}/chat/casual` : '/chat/casual';
      this.http.post<any>(apiUrl, { message: answer }).subscribe({
        next: (res) => {
          const reply = res.reply || 'Got it!';
          this.messages.push({ role: 'ai', text: marked.parse(reply) });
        },
        error: (err) => {
          console.error('API error:', err);
          this.messages.push({ role: 'ai', text: 'Sorry, something went wrong.' });
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
          this.messages.push({ role: 'ai', text: marked.parse(reply) });
          this.lastQuestion = this.extractQuestion(reply);
        },
        error: (err) => {
          console.error('API error:', err);
          this.messages.push({ role: 'ai', text: 'Error evaluating answer. Please try again.' });
        }
      });
    }
  }

  ngAfterViewChecked() {
    this.checkScroll();
  }

  checkScroll() {
    const container = document.querySelector('.chat-messages') as HTMLElement;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      this.showScrollButton = !isNearBottom && container.scrollHeight > container.clientHeight;
    }
  }

  scrollToBottom() {
    const container = document.querySelector('.chat-messages') as HTMLElement;
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 0);
    }
  }
}
