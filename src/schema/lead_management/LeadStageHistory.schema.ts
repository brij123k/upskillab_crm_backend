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
}

export const LeadStageHistorySchema =
  SchemaFactory.createForClass(
    LeadStageHistory,
  );