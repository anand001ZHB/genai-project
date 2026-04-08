import { Component, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css']
})
export class Chat implements AfterViewChecked {

  userInput = '';
  messages: any[] = [];

  constructor(private http: HttpClient) { }

  sendMessage() {
    console.log("clicked");

    if (!this.userInput.trim()) return;

    const userMsg = this.userInput;

    // ✅ show user message FIRST
    this.messages.push({
      role: 'user',
      text: userMsg
    });

    this.userInput = '';

    const apiUrl = 'https://humble-garbanzo-jw94xq7wxvq2p7v6-3000.app.github.dev/chat';

    console.log("before api call");

    this.http.post<any>(apiUrl, {
      message: userMsg
    }).subscribe({
      next: (res) => {
        console.log("API response:", res);

        // ✅ show AI response AFTER API returns
        this.messages.push({
          role: 'ai',
          text: marked.parse(res.reply || 'No response')
        });
      },
      error: (err) => {
        console.error("API error:", err);

        this.messages.push({
          role: 'ai',
          text: 'Error fetching response'
        });
      }
    });
  }

  // 🔥 Auto-scroll logic
  ngAfterViewChecked() {
    const container = document.querySelector('.chat-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
}