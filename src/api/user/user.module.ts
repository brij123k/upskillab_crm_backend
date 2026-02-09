import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserLogic } from './user.logic';
import { UserData } from './user.data';
import { User, UserSchema } from 'src/schema/user.schema';
import { ProfileModule } from '../profile/profile.module';
import { Profile,ProfileSchema } from 'src/schema/profile.schema';
import { UserActivityModule } from '../user-activity/user-activity.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
    ProfileModule,
    UserActivityModule,
  ],
  controllers: [UserController],
  providers: [UserLogic, UserData],
  exports:[UserData,UserLogic]
})
export class UserModule {}
