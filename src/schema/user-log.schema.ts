import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum UserLogAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

export enum UserLogStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class UserLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  userId?: Types.ObjectId;

  @Prop()
  ip?: string;

  @Prop()
  device?: string;

  @Prop({ enum: UserLogAction, required: true })
  action: UserLogAction;

  @Prop({ enum: UserLogStatus, required: true })
  status: UserLogStatus;

  @Prop({ required: true })
  log: string;

  @Prop()
  reason?: string;

  @Prop({ type: Object })
  meta?: any;
}

export const UserLogSchema = SchemaFactory.createForClass(UserLog);
