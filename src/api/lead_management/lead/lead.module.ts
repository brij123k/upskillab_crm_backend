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
import { Pool, PoolSchema } from 'src/schema/Pool.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import { MaskSetting,MaskSettingSchema } from 'src/schema/mask.schema';
import { LeadStageHistoryModule } from '../LeadStageHistory/LeadStageHistory.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: MeetingLog.name, schema: MeetingLogSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: LeadStage.name, schema: LeadStageSchema },
      { name: Pool.name, schema: PoolSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: MaskSetting.name, schema: MaskSettingSchema },
    ]),
    LeadHistoryModule,
    ProfileModule,
    NotificationModule,
    UserModule,
    LeadScheduleModule,
    UserActivityModule,
    LeadStageHistoryModule,
  ],
  controllers: [LeadController],
  providers: [LeadLogic, LeadData],
  exports:[LeadLogic, LeadData]
})
export class LeadModule {}
