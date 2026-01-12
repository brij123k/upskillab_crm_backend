import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { mongooseConfig } from './database.config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: mongooseConfig,
    }),
  ],
})
export class DatabaseModule {}
