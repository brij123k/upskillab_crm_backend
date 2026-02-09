import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class UserActivity extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  action: string;

  @Prop()
  referenceType?: string;

  @Prop()
  referenceId?: string;

  @Prop({ type: Object })
  meta?: any;
}

export const UserActivitySchema =
  SchemaFactory.createForClass(UserActivity);
