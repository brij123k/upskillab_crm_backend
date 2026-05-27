import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Target, TargetSchema } from 'src/schema/target.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { MeetingLog, MeetingLogSchema } from 'src/schema/meeting-log.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import { Task, TaskSchema } from 'src/schema/task.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { TargetsController } from './targets.controller';
import { TargetsData } from './targets.data';
import { TargetsLogic } from './targets.logic';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [
    ProfileModule,
    MongooseModule.forFeature([
      { name: Target.name, schema: TargetSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: MeetingLog.name, schema: MeetingLogSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Task.name, schema: TaskSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [TargetsController],
  providers: [TargetsLogic, TargetsData],
  exports: [TargetsLogic],
})
export class TargetsModule {}
