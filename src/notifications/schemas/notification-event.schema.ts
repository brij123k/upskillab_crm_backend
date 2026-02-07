import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NOTIFICATION_EVENT } from '../enums/notification-event.enum';
import { NOTIFICATION_CHANNEL } from '../enums/notification-channel.enum';

@Schema({ timestamps: true })
export class NotificationEvent extends Document {
  @Prop({ enum: NOTIFICATION_EVENT, unique: true, required: true })
  code: NOTIFICATION_EVENT;

  @Prop()
  description: string;

  @Prop({
    type: [String],
    enum: NOTIFICATION_CHANNEL,
    default: [NOTIFICATION_CHANNEL.IN_APP],
  })
  defaultChannels: NOTIFICATION_CHANNEL[];

  @Prop({ default: true })
  isActive: boolean;
}

export const NotificationEventSchema =
  SchemaFactory.createForClass(NotificationEvent);
