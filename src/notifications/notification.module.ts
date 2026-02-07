import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  NotificationEvent,
  NotificationEventSchema,
} from './schemas/notification-event.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from './schemas/notification-log.schema';
import { NotificationWorker } from './workers/notification.worker';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';
import { NotificationEngineService } from './services/notification-engine.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationEvent.name, schema: NotificationEventSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
  ],
  controllers: [NotificationController],
//   providers: [NotificationWorker,NotificationService,NotificationGateway],
  providers: [NotificationService,NotificationGateway,NotificationEngineService],
    exports: [
    NotificationGateway,NotificationEngineService
  ],
})
export class NotificationModule {}
