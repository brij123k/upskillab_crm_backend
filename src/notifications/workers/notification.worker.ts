import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Worker } from 'bullmq';

import { Notification } from '../schemas/notification.schema';
import { NotificationLog } from '../schemas/notification-log.schema';

import {NOTIFICATION_CHANNEL} from '../enums/notification-channel.enum';
import { NOTIFICATION_STATUS } from '../enums/notification-status.enum';

import { redisConnection } from '../queues/notification.queue';

@Injectable()
export class NotificationWorker implements OnModuleInit {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,

    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLog>,
  ) {}

  onModuleInit() {
    new Worker(
      'notification-queue',
      async (job) => {
        const { notificationId, channel } = job.data;

        try {
          switch (channel) {
            case NOTIFICATION_CHANNEL.EMAIL:
              await this.sendEmail(notificationId);
              break;

            case NOTIFICATION_CHANNEL.WHATSAPP:
              await this.sendWhatsApp(notificationId);
              break;

            case NOTIFICATION_CHANNEL.PUSH:
              await this.sendPush(notificationId);
              break;
          }

          await this.notificationModel.findByIdAndUpdate(notificationId, {
            status: NOTIFICATION_STATUS.SENT,
          });

          await this.notificationLogModel.create({
            notificationId,
            channel,
            status: 'SUCCESS',
            sentAt: new Date(),
          });
        } catch (error) {
          await this.notificationLogModel.create({
            notificationId,
            channel,
            status: 'FAILED',
            error: error.message,
            retryCount: job.attemptsMade,
          });

          throw error; // BullMQ retry
        }
      },
      {
        connection: redisConnection,
      },
    );
  }

  /* ======================
     CHANNEL GATEWAYS
  ====================== */

  private async sendEmail(notificationId: string) {
    // fetch notification
    // fetch user email
    // send email
  }

  private async sendWhatsApp(notificationId: string) {
    // Twilio / Meta API
  }

  private async sendPush(notificationId: string) {
    // Firebase push
  }
}
