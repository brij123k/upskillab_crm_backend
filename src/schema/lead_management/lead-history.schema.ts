import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum LeadActionType {
  CREATED= 'created',
  UPDATED='updated',
  ASSIGNED = 'assigned',
  PULLED_BACK = 'pulled_back',
  REASSIGNED = 'reassigned',
  STATUS_CHANGED = 'status_changed',
  STAGE_CHANGED = 'stage_changed',
  CALL_LOG = 'call_log',
  MEET_LOG = 'meet_log',
}

@Schema({ timestamps: true })
export class LeadHistory extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Lead', required: true })
  leadId: Types.ObjectId;

  @Prop({ enum: LeadActionType, required: true })
  actionType: LeadActionType;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  fromUser?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  toUser?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actionBy: Types.ObjectId;

  @Prop({ type: Object })
  changes?: Record<string, any>;

  @Prop()
  reason?:string

  createdAt: Date;
}

export const LeadHistorySchema =
  SchemaFactory.createForClass(LeadHistory);
