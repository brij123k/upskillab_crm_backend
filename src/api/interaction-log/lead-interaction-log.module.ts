import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { InteractionLogController } from './interaction-log.controller';
import { InteractionLogLogic } from './interaction-log.logic';
import { InteractionLogData } from './interaction-log.data';

import {
  LeadInteractionLog,
  LeadInteractionLogSchema,
} from 'src/schema/lead-interaction-log.schema';

import { LeadHistoryModule } from '../lead_management/lead-history/lead-history.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { LeadModule } from '../lead_management/lead/lead.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeadInteractionLog.name, schema: LeadInteractionLogSchema },
    ]),
    LeadHistoryModule,
    UserActivityModule,
    LeadModule,
    UserModule,
  ],
  controllers: [InteractionLogController],
  providers: [InteractionLogLogic, InteractionLogData],
  exports: [InteractionLogLogic],
})
export class InteractionLogModule {}