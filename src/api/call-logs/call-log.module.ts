import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { CallLogController } from './call-log.controller';
import { CallLogLogic } from './call-log.logic';
import { CallLogData } from './call-log.data';
import { CallLogSchema,CallLog } from 'src/schema/call-log.schema';
import { LeadHistoryModule } from '../lead_management/lead-history/lead-history.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { CallLogReview,CallLogReviewSchema } from 'src/schema/all-log-review.schema';
import { LeadModule } from '../lead_management/lead/lead.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallLog.name, schema: CallLogSchema },
      { name: CallLogReview.name, schema: CallLogReviewSchema }
    ]),
    LeadHistoryModule,
    UserActivityModule,
    LeadModule,
    UserModule,
  ],
  controllers: [CallLogController],
  providers: [CallLogLogic, CallLogData],
})
export class callLogModule {}
