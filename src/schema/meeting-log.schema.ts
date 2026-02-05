import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class MeetingLog {
  @Prop({ required: true })
  leadId: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  meetingType: string;

  @Prop()
  outcome: string;

  @Prop()
  notes: string;

  @Prop({ type: Types.ObjectId, ref: 'LeadStage' })
  stageId: Types.ObjectId;

  @Prop({ required: true })
  startedAt: Date;

  @Prop({ required: true })
  duration: number; // minutes
}

export const MeetingLogSchema =
  SchemaFactory.createForClass(MeetingLog);

MeetingLogSchema.index({ leadId: 1, startedAt: -1 });
