import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class UserAppHistory extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop()
  deviceId?: string;

  @Prop()
  platform?: 'android' | 'ios';

  @Prop()
  ipAddress?: string;

  @Prop({ default: Date.now })
  loginAt: Date;

  @Prop()
  logoutAt?: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserAppHistorySchema =
  SchemaFactory.createForClass(UserAppHistory);
