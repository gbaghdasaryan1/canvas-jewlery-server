import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { buildCorsOptions } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Needed for correct client IPs (and thus rate limiting) behind a proxy.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors(buildCorsOptions(configService.get<string>('CORS_ORIGIN')));

  console.log(
    `Server running on port ${configService.get<number>('PORT') ?? 5050}`,
  );
  await app.listen(configService.get<number>('PORT') ?? 5050);
}

void bootstrap();
