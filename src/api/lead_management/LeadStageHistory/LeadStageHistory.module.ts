
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  LeadStageHistory,
  LeadStageHistorySchema,
} from 'src/schema/lead_management/LeadStageHistory.schema';

import { LeadStageHistoryService } from './LeadStageHistory.service';
import { StageHistoryBackfillService } from './stage-history-backfill.service';
import { LeadHistory, LeadHistorySchema } from 'src/schema/lead_management/lead-history.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadStage, LeadStageSchema } from 'src/schema/lead_management/lead-stage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: LeadStageHistory.name,
        schema: LeadStageHistorySchema,
      },
      { name: LeadHistory.name, schema: LeadHistorySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: LeadStage.name, schema: LeadStageSchema },
    ]),
  ],
  controllers: [],
  providers: [LeadStageHistoryService, StageHistoryBackfillService],
  exports: [LeadStageHistoryService],
})
export class LeadStageHistoryModule {}