import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadHistoryController } from './lead-history.controller';
import { LeadHistoryLogic } from './lead-history.logic';
import { LeadHistoryData } from './lead-history.data';
import {
  LeadHistory,
  LeadHistorySchema,
} from 'src/schema/lead_management/lead-history.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeadHistory.name, schema: LeadHistorySchema },
    ]),
  ],
  controllers: [LeadHistoryController],
  providers: [LeadHistoryLogic, LeadHistoryData],
  exports: [LeadHistoryLogic],
})
export class LeadHistoryModule {}
