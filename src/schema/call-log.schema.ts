import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
@Schema({ timestamps: true })
export class CallLog extends Document {
  @Prop({ required: true })
  leadId: number; // numeric leadId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  duration: number; // seconds

  @Prop()
  outcome: string;

  @Prop({ type: Types.ObjectId, ref: 'LeadStage' })
  stageId?: Types.ObjectId;

  @Prop({ required: true })
  startedAt: Date;

  // @Prop()
  // reminder?:Date;
}

export const CallLogSchema = SchemaFactory.createForClass(CallLog);
