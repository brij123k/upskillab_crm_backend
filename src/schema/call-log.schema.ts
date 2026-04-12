import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
@Schema({ timestamps: true })
export class CallLog extends Document {

  @Prop({required:false})
  refId?: string;
  
  @Prop({ required: true })
  leadId: number; // numeric leadId

  @Prop({ref: 'User', required: true })
  userId: string;

  @Prop({required:false})
  agentNumber?: string;

  @Prop({required:false})
  customerNumber?: string;

  @Prop({default:"0"})
  duration: number; 

  @Prop()
  outcome?: string;

  @Prop({ref: 'LeadStage' })
  stageId: string;

  @Prop()
  startedAt: Date;

  @Prop()
  isFormSubmitted: boolean

  @Prop()
  recording_url?:string;

  // @Prop()
  // reminder?:Date;
}

export const CallLogSchema = SchemaFactory.createForClass(CallLog);
