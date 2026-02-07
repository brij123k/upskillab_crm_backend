import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { NOTIFICATION_EVENT } from '../enums/notification-event.enum';
import { NOTIFICATION_CHANNEL } from '../enums/notification-channel.enum';

@Schema({ timestamps: true })
export class NotificationPreference extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', unique: true })
  userId: Types.ObjectId;

  @Prop({
    type: [
      {
        eventCode: { type: String, enum: NOTIFICATION_EVENT },
        channels: {
          IN_APP: { type: Boolean, default: true },
          EMAIL: { type: Boolean, default: true },
          PUSH: { type: Boolean, default: false },
          WHATSAPP: { type: Boolean, default: false },
        },
      },
    ],
    default: [],
  })
  preferences: {
    eventCode: NOTIFICATION_EVENT;
    channels: Record<NOTIFICATION_CHANNEL, boolean>;
  }[];
}

export const NotificationPreferenceSchema =
  SchemaFactory.createForClass(NotificationPreference);
