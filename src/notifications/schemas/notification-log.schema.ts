import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { NOTIFICATION_CHANNEL } from '../enums/notification-channel.enum';

@Schema({ timestamps: true })
export class NotificationLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Notification', index: true })
  notificationId: Types.ObjectId;

  @Prop({ enum: NOTIFICATION_CHANNEL, required: true })
  channel: NOTIFICATION_CHANNEL;

  @Prop({ enum: ['SUCCESS', 'FAILED'], required: true })
  status: 'SUCCESS' | 'FAILED';

  @Prop()
  error?: string;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop()
  sentAt: Date;
}

export const NotificationLogSchema =
  SchemaFactory.createForClass(NotificationLog);
