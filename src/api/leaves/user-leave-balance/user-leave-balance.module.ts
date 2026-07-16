import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  UserLeaveBalance,
  UserLeaveBalanceSchema,
} from 'src/schema/user-leave-balance.schema';
import {
  LeavePolicy,
  LeavePolicySchema,
} from 'src/schema/leave-policy.schema';
import {
  User,
  UserSchema,
} from 'src/schema/user.schema';
import { UserLeaveBalanceCron } from './user-leave-balance.cron';
import { UserLeaveBalanceController } from './user-leave-balance.controller';
import { UserLeaveBalanceService } from './user-leave-balance.service';
import { ScheduleModule } from '@nestjs/schedule';
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      {
        name: UserLeaveBalance.name,
        schema: UserLeaveBalanceSchema,
      },
      {
        name: LeavePolicy.name,
        schema: LeavePolicySchema,
      },
      {
        name: User.name,
        schema: UserSchema,
      },
    ]),
  ],

  controllers: [UserLeaveBalanceController],

  providers: [UserLeaveBalanceService,UserLeaveBalanceCron],

  exports: [UserLeaveBalanceService],
})
export class UserLeaveBalanceModule {}