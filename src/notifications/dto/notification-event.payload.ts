import { NOTIFICATION_ENTITY } from "../enums/notification-entity.enum";
import { NOTIFICATION_EVENT } from "../enums/notification-event.enum";


export interface NotificationEventPayload {
  event: NOTIFICATION_EVENT;

  actorId?: string;           // Who triggered it (admin/system/user)
  recipients: {
    userIds?: string[];
    roles?: string[];
    departments?: string[];
    broadcast?: boolean;
  };

  title: string;
  message: string;

  entity?: {
    type: NOTIFICATION_ENTITY;
    id: string;
  };

  metadata?: {
    redirectUrl?: string;
    [key: string]: any;
  };
}
