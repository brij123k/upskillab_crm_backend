import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { HolidayController } from './holiday.controller';
import { HolidayLogic } from './holiday.logic';
import { HolidayData } from './holiday.data';

import {
  Holiday,
  HolidaySchema,
} from 'src/schema/holiday.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Holiday.name,
        schema: HolidaySchema,
      },
    ]),
  ],

  controllers: [
    HolidayController,
  ],

  providers: [
    HolidayLogic,
    HolidayData,
  ],

  exports: [
    HolidayLogic,
  ],
})
export class HolidayModule {}