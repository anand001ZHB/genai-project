import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class ChatService {

  private openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
     baseURL: "https://api.groq.com/openai/v1",
  });

  async getAIResponse(message: string) {

    console.log("Incoming message:", message);
    console.log("API KEY:", process.env.GROQ_API_KEY); // 👈 check this

    try {
      const response = await this.openai.chat.completions.create({
        model: "llama-3.1-8b-instant",   // 👈 GROQ model
        messages: [
          {
            role: 'system',
            content: `
You are a senior software engineer and interviewer.

Your job:
- Answer interview questions clearly
- Explain from basics
- Provide examples
- Use structured format
- Explain with images as well
- Explain with flowchart as well
- Ask follow-up questions

Focus:
JavaScript, Angular, Web Development, line by line code explanation, 
`
          },
          {
            role: 'user',
            content: message
          }
        ],
      });

      console.log("OpenAI success");

      return {
        reply: response.choices[0].message.content,
      };

    } catch (error) {
      console.error("OpenAI ERROR:", error);  // 👈 CRITICAL

      return {
        reply: "Something went wrong while fetching response."
      };
    }
  }
}