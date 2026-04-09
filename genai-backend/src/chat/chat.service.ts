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
}

@Injectable()
export class ChatService {

  private openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  private buildSystemPrompt() {
    return `You are an experienced technical interviewer conducting a one-on-one interview. Your tone should be warm, direct, and professional.

When asking questions:
- Be clear and conversational
- Ask focused, practical questions
- Wait for the candidate's response

When evaluating answers:
- Talk directly to the candidate using "you"
- Be specific about what you liked
- Point out gaps naturally, not in a list
- Suggest improvements in a friendly way
- Give a rating (1-10) briefly
- Ask a follow-up question that helps them think deeper

Keep responses concise and natural. Avoid bullet points unless necessary. Sound like a real person, not a robot.
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

    const startPrompt = `Start a technical interview with a candidate.

Setup:
- Interview difficulty: ${level}
- Candidate experience: ${experience}
- Topic to be interviewed on: ${topic}
- Candidate's self-rated skill level: ${selfRating}/10 (${difficultyMap[selfRating] || 'intermediate'})
- Adjust question difficulty to ${questionDifficulty}

Greet them warmly using their self-rating to personalize the interview. Briefly explain the interview format (you'll ask questions, they answer, you give feedback on their response). Then ask your first question on ${topic}.

Tailor the question difficulty based on their self-rating:
- If they rated 1-3: Ask a foundational question
- If they rated 4-6: Ask an intermediate question
- If they rated 7-10: Ask a challenging question

Keep it conversational and friendly. Ask ONE focused question.
`;

    return this.getAIResponse(startPrompt);
  }

  async evaluateAnswer(payload: AnswerPayload) {
    const level = payload.level || 'medium';
    const experience = payload.experience || '0-1 years';
    const topic = payload.topic || 'JavaScript';
    const question = payload.question || 'Interview question';
    const answer = payload.answer;

    const isShortAnswer = answer.trim().split(' ').length < 10;

    if (isShortAnswer) {
      // If answer is too short, provide the correct answer with detailed explanations
      const prompt = `A candidate was asked this interview question and gave a very brief answer. Your job is to teach them the proper answer.

Question asked:
"${question}"

Their short answer:
"${answer}"

Candidate details: ${level} difficulty, ${experience} experience, ${topic}

Please do the following:
1. Acknowledge their attempt
2. Provide the correct answer in clear, simple terms
3. Explain WHY this is the correct approach (explain your thinking process)
4. Give a practical real-world example to make it concrete
5. Explain it in a second way using an analogy or different perspective
6. Point out common misconceptions people have
7. Ask them to try explaining it back to you in their own words

Make it educational and encouraging. Use "you" when talking to them. Format it naturally, not as a numbered list.
`;
      return this.getAIResponse(prompt);
    } else {
      // For longer answers, do normal evaluation
      const prompt = `You are interviewing a candidate. Here's their response to evaluate.

Question asked:
"${question}"

Their answer:
"${answer}"

Candidate details: ${level} difficulty, ${experience} experience, ${topic}

Now evaluate their answer in a conversational way, as if you're talking to them directly. Include:
1. What they did well (be specific)
2. What could be improved or what's missing
3. A brief rating (1-10)
4. How to answer better (in 1-2 sentences max)
5. A follow-up question to dig deeper

Keep it natural and conversational. Use "you" when talking to them. Avoid numbered lists or too much formatting. Sound like you're having a real conversation.
`;
      return this.getAIResponse(prompt);
    }
  }
}
