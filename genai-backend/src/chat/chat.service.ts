import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

interface InterviewConfig {
  level?: string;
  experience?: string;
  topic?: string;
  selfRating?: number;
}

interface AnswerPayload extends InterviewConfig {
  answer: string;
  question: string;
  stuckAttempts?: number;
  responseSignal?: 'normal' | 'dont_know' | 'move_on' | 'greeting';
}

@Injectable()
export class ChatService {

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

  private openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

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
      const response = await this.openai.chat.completions.create({
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
      const response = await this.openai.chat.completions.create({
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

    return this.getAIResponse(startPrompt);
  }

  async evaluateAnswer(payload: AnswerPayload) {
    const level = payload.level || 'medium';
    const experience = payload.experience || '0-1 years';
    const topic = payload.topic || 'JavaScript';
    const question = payload.question || 'Interview question';
    const answer = payload.answer;
    const stuckAttempts = payload.stuckAttempts || 0;
    const responseSignal = payload.responseSignal || 'normal';

    if (responseSignal === 'greeting') {
      return {
        reply: this.buildGreetingReply(question),
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

      return this.getAIResponse(moveAheadPrompt);
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

    return this.getAIResponse(prompt);
  }
}
