import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',   // 👈 allow all (for now)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
  });

  const requestedPort = Number.parseInt(process.env.PORT || '3000', 10) || 3000;

  try {
    await app.listen(requestedPort);
    console.log(`Backend listening on port ${requestedPort}`);
  } catch (error: any) {
    if (error?.code === 'EADDRINUSE') {
      console.error(
        `Port ${requestedPort} is already in use. Stop the existing process or run with a different port, e.g. PORT=3001 npm run start:dev`,
      );
    }
    throw error;
  }
}
bootstrap();