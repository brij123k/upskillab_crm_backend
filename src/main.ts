import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
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

 const config = new DocumentBuilder()
    .setTitle('CRM Backend API')
    .setDescription('CRM Backend APIs documentation')
    .setVersion('1.0')
    .addBearerAuth() // 👈 IMPORTANT (JWT)
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, document);

app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
