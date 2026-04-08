import { Component } from '@angular/core';
import { Chat } from './chat/chat';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Chat],   // 👈 VERY IMPORTANT
  templateUrl: './app.html',
})
export class App {}