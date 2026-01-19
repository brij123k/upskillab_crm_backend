import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) => {
      const firstError = errors[0];

      const message =
        firstError.constraints
          ? Object.values(firstError.constraints)[0]
          : 'Validation failed';

      return new BadRequestException({
        success: false,
        message,
      });
    },
  }),
);

app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
