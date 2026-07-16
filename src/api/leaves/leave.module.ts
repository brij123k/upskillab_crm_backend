import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveController } from './leave.controller';
import { LeaveLogic } from './leave.logic';
import { LeaveData } from './leave.data';
import { LeavePolicyData } from './leave-policy.data';
import { LeaveRequest, LeaveRequestSchema } from 'src/schema/leave.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Profile, ProfileSchema } from 'src/schema/profile.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import { LeavePolicy, LeavePolicySchema } from 'src/schema/leave-policy.schema';
import { NotificationModule } from 'src/notifications/notification.module';
import { UserLeaveBalanceModule } from './user-leave-balance/user-leave-balance.module';

@Module({
  imports: [
    NotificationModule,
    MongooseModule.forFeature([
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: LeavePolicy.name, schema: LeavePolicySchema },
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    UserLeaveBalanceModule
  ],
  controllers: [LeaveController],
  providers: [LeaveLogic, LeaveData, LeavePolicyData],
  exports: [LeaveLogic, LeaveData],
})
export class LeaveModule {}
