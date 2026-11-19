import {
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LeadStageHistoryDocument =
  HydratedDocument<LeadStageHistory>;

@Schema({
  timestamps: true,
  versionKey: false,
})
export class LeadStageHistory {
  @Prop({
    type: Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true,
  })
  leadId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'LeadStage',
    required: true,
    index: true,
  })
  stageId: Types.ObjectId;

  @Prop({
    required: true,
    trim: true,
  })
  stageName: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    default: Date.now,
    index: true,
  })
  changedAt: Date;

  /** Where the row came from: 'lead' (stage change), 'call' (call feedback), 'backfill_call_log'. */
  @Prop()
  source?: string;

  /** Call log that changed the stage (call feedback / backfill). */
  @Prop({ type: Types.ObjectId, ref: 'CallLog' })
  callLogId?: Types.ObjectId;
}

export const LeadStageHistorySchema =
  SchemaFactory.createForClass(
    LeadStageHistory,
  );