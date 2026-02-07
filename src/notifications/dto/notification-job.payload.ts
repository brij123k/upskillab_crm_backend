import { NOTIFICATION_CHANNEL } from '../enums/notification-channel.enum';

export interface NotificationJobPayload {
  notificationId: string;
  userId: string;
  channel: NOTIFICATION_CHANNEL;
}
