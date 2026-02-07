import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Notification } from '../schemas/notification.schema';
import { NotificationPreference } from '../schemas/notification-preference.schema';

import { NOTIFICATION_CHANNEL } from '../enums/notification-channel.enum';
import { NOTIFICATION_STATUS } from '../enums/notification-status.enum';
import { NotificationEventPayload } from '../dto/notification-event.payload';

import { NotificationGateway } from '../notification.gateway';
import { notificationQueue } from '../queues/notification.queue';

@Injectable()
export class NotificationEngineService {
    constructor(
        @InjectModel(Notification.name)
        private readonly notificationModel: Model<Notification>,

        @InjectModel(NotificationPreference.name)
        private readonly preferenceModel: Model<NotificationPreference>,

        private readonly notificationGateway: NotificationGateway, // socket
    ) { }

    /* ================================
       ENTRY POINT
    ================================= */
    async handleEvent(payload: NotificationEventPayload): Promise<void> {
        const userIds = await this.resolveRecipients(payload);

        if (!userIds.length) return;

        for (const userId of userIds) {
            const channels = await this.resolveChannels(userId, payload.event);

            for (const channel of channels) {
                const notification = await this.createNotification(
                    userId,
                    channel,
                    payload,
                );

                // 🔔 Real-time in-app push
                if (channel === NOTIFICATION_CHANNEL.IN_APP) {
                    this.notificationGateway.emitToUser(
                        userId.toString(),
                        notification,
                    );
                }

                // if (channel !== NOTIFICATION_CHANNEL.IN_APP) {
                //     await notificationQueue.add(
                //         'send-notification',
                //         {
                //             notificationId: notification._id.toString(),
                //             userId: userId.toString(),
                //             channel,
                //         },
                //         {
                //             attempts: 3,
                //             backoff: {
                //                 type: 'exponential',
                //                 delay: 5000,
                //             },
                //             removeOnComplete: true,
                //         },
                //     );
                // }
            }
        }
    }

    /* ================================
       RECIPIENT RESOLUTION
    ================================= */
    private async resolveRecipients(
        payload: NotificationEventPayload,
    ): Promise<Types.ObjectId[]> {
        const recipients: Types.ObjectId[] = [];

        if (payload.recipients.userIds?.length) {
            recipients.push(
                ...payload.recipients.userIds.map((id) => new Types.ObjectId(id)),
            );
        }

        // 🔥 Role / Department resolution
        // (You’ll wire UserService here)
        // if (payload.recipients.roles) { ... }
        // if (payload.recipients.departments) { ... }

        return [...new Set(recipients.map((id) => id.toString()))].map(
            (id) => new Types.ObjectId(id),
        );
    }

    /* ================================
       CHANNEL RESOLUTION (PREFERENCES)
    ================================= */
    private async resolveChannels(
        userId: Types.ObjectId,
        event: string,
    ): Promise<NOTIFICATION_CHANNEL[]> {
        const pref = await this.preferenceModel.findOne({ userId });

        // Default fallback
        if (!pref) {
            return [NOTIFICATION_CHANNEL.IN_APP];
        }

        const eventPref = pref.preferences.find(
            (p) => p.eventCode === event,
        );

        if (!eventPref) {
            return [NOTIFICATION_CHANNEL.IN_APP];
        }

        return Object.entries(eventPref.channels)
            .filter(([, enabled]) => enabled)
            .map(([channel]) => channel as NOTIFICATION_CHANNEL);
    }

    /* ================================
       CREATE NOTIFICATION
    ================================= */
    private async createNotification(
        userId: Types.ObjectId,
        channel: NOTIFICATION_CHANNEL,
        payload: NotificationEventPayload,
    ): Promise<Notification> {
        const notification = await this.notificationModel.create({
            userId,
            title: payload.title,
            message: payload.message,
            type: payload.event,
            channel,
            status: NOTIFICATION_STATUS.PENDING,
            entity: payload.entity
                ? {
                    type: payload.entity.type,
                    id: new Types.ObjectId(payload.entity.id),
                }
                : undefined,
            metadata: payload.metadata,
            createdBy: payload.actorId
                ? new Types.ObjectId(payload.actorId)
                : null,
        });

        return notification;
    }
}
