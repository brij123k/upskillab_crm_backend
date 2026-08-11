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
  const flattenErrors = (
    validationErrors: any[],
    parentPath = '',
  ): string[] => {
    const messages: string[] = [];

    for (const error of validationErrors) {
      const path = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

      // Direct validation error
      if (error.constraints) {
        messages.push(
          ...Object.values(error.constraints).map(
            (message: any) =>
              `${path}: ${message}`,
          ),
        );
      }

      // Nested validation error
      if (error.children?.length) {
        messages.push(
          ...flattenErrors(
            error.children,
            path,
          ),
        );
      }
    }

    return messages;
  };

  const messages = flattenErrors(errors);

  return new BadRequestException({
    success: false,
    message: 'Validation failed',
    errors: messages,
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
