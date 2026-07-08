
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  LeadStageHistory,
  LeadStageHistorySchema,
} from 'src/schema/lead_management/LeadStageHistory.schema';

import { LeadStageHistoryService } from './LeadStageHistory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: LeadStageHistory.name,
        schema: LeadStageHistorySchema,
      },
    ]),
  ],
  controllers: [],
  providers: [LeadStageHistoryService],
  exports: [LeadStageHistoryService],
})
export class LeadStageHistoryModule {}