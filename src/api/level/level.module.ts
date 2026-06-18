import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Level,
  LevelSchema,
} from 'src/schema/level.schema';

import { LevelController } from './level.controller';
import { LevelService } from './level.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Level.name,
        schema: LevelSchema,
      },
    ]),
  ],
  controllers: [LevelController],
  providers: [LevelService],
  exports: [LevelService],
})
export class LevelModule {}