import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';

import {
  LeadSchedule,
  LeadScheduleSchema,
} from 'src/schema/lead_management/lead-schedule.schema';

import { LeadScheduleData } from './lead-schedule.data';
import { LeadScheduleLogic } from './lead-schedule.logic';
import { LeadScheduleController } from './lead-schedule.controller';
import { LeadScheduleCron } from './lead-schedule.cron';
import { SocketModule } from 'src/api/socket/socket.module';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadHistoryModule } from '../lead-history/lead-history.module';
import { UserModule } from 'src/api/user/user.module';
import { LeadAutoAssignService } from './lead-auto-assign.service';
import { User, UserSchema } from 'src/schema/user.schema';
import {
  LeadStage,
  LeadStageSchema,
} from 'src/schema/lead_management/lead-stage.schema';
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      {
        name: LeadSchedule.name,
        schema: LeadScheduleSchema,
      },
      { name: Lead.name, schema: LeadSchema },
        { name: User.name, schema: UserSchema }, 
        { name: LeadStage.name, schema: LeadStageSchema },
    ]),
    SocketModule,
    LeadHistoryModule,
    UserModule
  ],
  controllers: [LeadScheduleController],
  providers: [
    LeadScheduleData,
    LeadScheduleLogic,
    LeadScheduleCron,
    LeadAutoAssignService,
  ],
  exports: [LeadScheduleData]
})
export class LeadScheduleModule { }
