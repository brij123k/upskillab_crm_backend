import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { LeadStatsController } from './leadStats.controller';
import { LeadStatsService } from './leadStats.service';

import {
  Lead,
  LeadSchema,
} from 'src/schema/lead_management/lead.schema';
import { LeadStage,LeadStageSchema } from 'src/schema/lead_management/lead-stage.schema';
import {
  Order,
  OrderSchema,
} from 'src/schema/order_Management/order.schema';
import { LeadSchedule,LeadScheduleSchema } from 'src/schema/lead_management/lead-schedule.schema';
import { UserModule } from '../user/user.module';
import { LeadStageHistory,LeadStageHistorySchema } from 'src/schema/lead_management/LeadStageHistory.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Lead.name,
        schema: LeadSchema,
      },
      {
        name: Order.name,
        schema: OrderSchema,
      },
      {
        name: LeadSchedule.name,
        schema: LeadScheduleSchema,
      },
      {
        name: LeadStage.name,
        schema: LeadStageSchema,
      },
      {
        name: LeadStageHistory.name,
        schema: LeadStageHistorySchema,
      }
    ]),
    UserModule,
  ],
  controllers: [LeadStatsController],
  providers: [LeadStatsService],
  exports: [LeadStatsService],
})
export class LeadStatsModule {}