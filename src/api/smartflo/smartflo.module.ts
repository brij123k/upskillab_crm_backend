import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Profile, ProfileSchema } from 'src/schema/profile.schema';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { SmartfloService } from './smartflo.service';
import { IVRController } from './smartflo.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { LeadSchedule, LeadScheduleSchema } from 'src/schema/lead_management/lead-schedule.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { SocketModule } from '../socket/socket.module';
import { LeadHistoryModule } from '../lead_management/lead-history/lead-history.module';
import { CallLogReview, CallLogReviewSchema } from 'src/schema/all-log-review.schema';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: CallLog.name, schema: CallLogSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: CallLogReview.name, schema: CallLogReviewSchema },
    ]),
    SocketModule,
    LeadHistoryModule,
    UserActivityModule,
  ],
  controllers: [IVRController],
  providers: [SmartfloService],
  exports: [SmartfloService]
})
export class SmartfloModule { }
