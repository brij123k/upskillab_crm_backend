import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserLogic } from './user.logic';
import { UserData } from './user.data';
import { User, UserSchema } from 'src/schema/user.schema';
import { ProfileModule } from '../profile/profile.module';
import { Profile,ProfileSchema } from 'src/schema/profile.schema';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { SmartfloModule } from '../smartflo/smartflo.module';
import { UserLogModule } from '../user-logs/user-log.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { Role, RoleSchema } from 'src/schema/role.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    ProfileModule,
    UserActivityModule,
    SmartfloModule,
    UserLogModule,
    AttendanceModule,
  ],
  controllers: [UserController],
  providers: [UserLogic, UserData],
  exports:[UserData,UserLogic]
})
export class UserModule {}
