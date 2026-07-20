import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserActivityController } from './user-activity.controller';
import { UserActivityLogic } from './user-activity.logic';
import { UserActivityData } from './user-activity.data';
import { UserActivity,UserActivitySchema } from 'src/schema/user-activity.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';


@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserActivity.name, schema: UserActivitySchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [UserActivityController],
  providers: [UserActivityLogic, UserActivityData],
  exports: [UserActivityLogic],
})
export class UserActivityModule {}
