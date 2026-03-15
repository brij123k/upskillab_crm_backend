import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class LeadInteractionLog extends Document {

  @Prop({ required: true })
  leadId: number;

  @Prop({ ref: 'User', required: true })
  userId: string;

  // source of interaction
  // enum: ['whatsapp', 'email', 'sms', 'linkedin', 'manual', 'other'],
  @Prop({
    default: 'other',
  })
  source: string;

  // what happened
  @Prop({ required: true })
  outcome: string;

  // optional stage change
  @Prop({ ref: 'LeadStage' })
  stageId?: string;

  @Prop({ required: true })
  interactionAt: Date;

}

export const LeadInteractionLogSchema =
  SchemaFactory.createForClass(LeadInteractionLog);