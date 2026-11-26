import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/schema/user.schema';
import { Profile, ProfileSchema } from 'src/schema/profile.schema';
import { UserModule } from '../user/user.module';
import { ProfileUploadModule } from '../file-uploader/file-uploader.module';
import {
  OnboardingPublicController,
  OnboardingStaffController,
} from './onboarding.controller';
import { OnboardingLogic } from './onboarding.logic';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
    UserModule,
    ProfileUploadModule,
    PayrollModule,
  ],
  controllers: [OnboardingStaffController, OnboardingPublicController],
  providers: [OnboardingLogic],
})
export class OnboardingModule {}
