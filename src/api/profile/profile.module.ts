import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProfileController } from './profile.controller';
import { ProfileLogic } from './profile.logic';
import { ProfileData } from './profile.data';
import { Profile, ProfileSchema } from 'src/schema/profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Profile.name, schema: ProfileSchema },
    ]),
  ],
  controllers: [ProfileController],
  providers: [ProfileLogic, ProfileData],
  exports: [ProfileLogic,ProfileData],
})
export class ProfileModule {}
