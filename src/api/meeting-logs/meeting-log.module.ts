import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeetingLogController } from './meeting-log.controller';
import { MeetingLogLogic } from './meeting-log.logic';
import { MeetingLogData } from './meeting-log.data';
import { MeetingLog,MeetingLogSchema } from 'src/schema/meeting-log.schema';
import { MeetingFeedback,MeetingFeedbackSchema } from 'src/schema/meeting-feedback.schema';
import { LeadHistoryModule } from '../lead_management/lead-history/lead-history.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { LeadModule } from '../lead_management/lead/lead.module';
import { MeetingFeedbackLogData } from './meeting-feedback.data';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MeetingLog.name, schema: MeetingLogSchema },
      { name: MeetingFeedback.name, schema: MeetingFeedbackSchema },
    ]),
    LeadHistoryModule,
    UserActivityModule,
    LeadModule,
    UserModule
  ],
  controllers: [MeetingLogController],
  providers: [MeetingLogLogic, MeetingLogData,MeetingFeedbackLogData],
})
export class MeetingLogModule {}
