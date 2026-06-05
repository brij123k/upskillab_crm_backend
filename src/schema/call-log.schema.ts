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
/**
 * PERFORMANCE INDEXES
 */

// Most used query
CallLogSchema.index({
  userId: 1,
  createdAt: -1,
});

// Unique call per lead query
CallLogSchema.index({
  leadId: 1,
  createdAt: -1,
});

// Stage filtering
CallLogSchema.index({
  stageId: 1,
});

// Outcome filtering
CallLogSchema.index({
  outcome: 1,
});

// Duration filtering
CallLogSchema.index({
  duration: 1,
});

// Date filtering
CallLogSchema.index({
  createdAt: -1,
});

// User + Lead combo
CallLogSchema.index({
  userId: 1,
  leadId: 1,
});

// User + Date range
CallLogSchema.index({
  userId: 1,
  createdAt: -1,
  leadId: 1,
});