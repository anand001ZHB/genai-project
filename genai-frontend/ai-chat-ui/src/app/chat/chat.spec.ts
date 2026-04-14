import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Chat } from './chat';

describe('Chat', () => {
  let component: Chat;
  let fixture: ComponentFixture<Chat>;
  let speakCalls = 0;
  let cancelCalls = 0;

  beforeEach(async () => {
    speakCalls = 0;
    cancelCalls = 0;

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: () => {
          speakCalls += 1;
        },
        cancel: () => {
          cancelCalls += 1;
        },
        paused: false,
        resume: () => {},
        getVoices: () => [{ name: 'Test Voice', lang: 'en-US', default: true } as SpeechSynthesisVoice],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });

    (globalThis as any).SpeechSynthesisUtterance = function (this: any, text: string) {
      this.text = text;
    } as any;

    await TestBed.configureTestingModule({
      imports: [Chat],
    }).compileComponents();

    fixture = TestBed.createComponent(Chat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('plays a voice preview when a new voice is selected', async () => {
    component.soundEnabled = true;
    component.ttsSupported = true;
    component.availableSpeechVoices = [{ name: 'Test Voice', lang: 'en-US', default: true } as SpeechSynthesisVoice];
    component.selectedSpeechVoiceName = 'Test Voice';

    component.onSpeechVoiceChange();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(cancelCalls).toBeGreaterThan(0);
    expect(speakCalls).toBeGreaterThan(0);
  });
});
