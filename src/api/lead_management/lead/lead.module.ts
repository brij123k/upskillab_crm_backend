import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadController } from './lead.controller';
import { LeadLogic } from './lead.logic';
import { LeadData } from './lead.data';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadHistoryModule } from '../lead-history/lead-history.module';
import { ProfileModule } from 'src/api/profile/profile.module';
import { MeetingLog,MeetingLogSchema } from 'src/schema/meeting-log.schema';
import { CallLog,CallLogSchema } from 'src/schema/call-log.schema';
import { NotificationModule } from 'src/notifications/notification.module';
import { UserModule } from 'src/api/user/user.module';
import { callLogModule } from 'src/api/call-logs/call-log.module';
import { LeadScheduleModule } from '../lead-schedule/lead-schedule.module';
import { LeadStage,LeadStageSchema } from 'src/schema/lead_management/lead-stage.schema';
import { UserActivityModule } from 'src/api/user-activity/user-activity.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: MeetingLog.name, schema: MeetingLogSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: LeadStage.name, schema: LeadStageSchema },
    ]),
    LeadHistoryModule,
    ProfileModule,
    NotificationModule,
    UserModule,
    LeadScheduleModule,
    UserActivityModule,
  ],
  controllers: [LeadController],
  providers: [LeadLogic, LeadData],
  exports:[LeadLogic]
})
export class LeadModule {}
