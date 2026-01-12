import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserLogic } from './user.logic';
import { UserData } from './user.data';
import { User, UserSchema } from 'src/schema/user.schema';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ProfileModule,
  ],
  controllers: [UserController],
  providers: [UserLogic, UserData],
})
export class UserModule {}
