import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementData } from './announcement.data';
import { AnnouncementLogic } from './announcement.logic';
import { Announcement, AnnouncementSchema } from 'src/schema/announcement.schema';
import { NotificationModule } from 'src/notifications/notification.module';
import { ProfileModule } from 'src/api/profile/profile.module';
import { UserModule } from 'src/api/user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Announcement.name, schema: AnnouncementSchema },
    ]),
    NotificationModule,
    ProfileModule,
    UserModule,
  ],
  controllers: [AnnouncementController],
  providers: [AnnouncementLogic, AnnouncementData],
  exports: [AnnouncementLogic],
})
export class AnnouncementModule {}
