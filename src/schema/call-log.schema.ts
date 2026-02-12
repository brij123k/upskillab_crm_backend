import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
@Schema({ timestamps: true })
export class CallLog extends Document {
  @Prop({ required: true })
  leadId: number; // numeric leadId

  @Prop({ref: 'User', required: true })
  userId: string;

  @Prop({ required: true })
  duration: number; // seconds

  @Prop()
  outcome: string;

  @Prop({ref: 'LeadStage' })
  stageId?: string;

  @Prop({ required: true })
  startedAt: Date;

  // @Prop()
  // reminder?:Date;
}

export const CallLogSchema = SchemaFactory.createForClass(CallLog);
