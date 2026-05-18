import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveController } from './leave.controller';
import { LeaveLogic } from './leave.logic';
import { LeaveData } from './leave.data';
import { LeaveRequest, LeaveRequestSchema } from 'src/schema/leave.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Profile, ProfileSchema } from 'src/schema/profile.schema';
import { KraModule } from '../KRA/kra.module';
import { Kra, KraSchema } from 'src/schema/kra.schema';
import { NotificationModule } from 'src/notifications/notification.module';

@Module({
  imports: [
    KraModule,
    NotificationModule,
    MongooseModule.forFeature([
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Kra.name, schema: KraSchema },
    ]),
  ],
  controllers: [LeaveController],
  providers: [LeaveLogic, LeaveData],
  exports: [LeaveLogic],
})
export class LeaveModule {}
