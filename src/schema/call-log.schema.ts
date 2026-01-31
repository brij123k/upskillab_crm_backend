import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CallOutcome {
  CONNECTED = 'connected',
  NOT_CONNECTED = 'not_connected',
  BUSY = 'busy',
  FOLLOW_UP = 'follow_up',
  CONVERTED = 'converted',
}

@Schema({ timestamps: true })
export class CallLog extends Document {
  @Prop({ required: true })
  leadId: number; // numeric leadId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  duration: number; // seconds

  @Prop({ enum: CallOutcome, required: true })
  outcome: CallOutcome;

  @Prop()
  state?: string;

  @Prop({ type: Types.ObjectId, ref: 'LeadStage' })
  stageId?: Types.ObjectId;
}

export const CallLogSchema = SchemaFactory.createForClass(CallLog);
