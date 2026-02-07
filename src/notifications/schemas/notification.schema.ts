import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {NOTIFICATION_CHANNEL} from '../enums/notification-channel.enum';
import { NOTIFICATION_EVENT } from '../enums/notification-event.enum';
import { NOTIFICATION_STATUS } from '../enums/notification-status.enum';
import { NOTIFICATION_ENTITY } from '../enums/notification-entity.enum';

@Schema({ timestamps: true })
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ enum: NOTIFICATION_EVENT, required: true, index: true })
  type: NOTIFICATION_EVENT;

  @Prop({ enum: NOTIFICATION_CHANNEL, default: NOTIFICATION_CHANNEL.IN_APP })
  channel: NOTIFICATION_CHANNEL;

  @Prop({
    enum: NOTIFICATION_STATUS,
    default: NOTIFICATION_STATUS.PENDING,
  })
  status: NOTIFICATION_STATUS;

  @Prop({ default: false, index: true })
  isRead: boolean;

  @Prop({
    type: {
      type: String,
      enum: NOTIFICATION_ENTITY,
    },
    id: { type: Types.ObjectId },
  })
  entity?: {
    type: NOTIFICATION_ENTITY;
    id: Types.ObjectId;
  };

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop()
  readAt?: Date;
}

export const NotificationSchema =
  SchemaFactory.createForClass(Notification);

/* 🔥 Performance Indexes */
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
