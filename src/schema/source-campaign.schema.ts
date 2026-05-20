import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { LeadSource } from './lead_management/lead.schema';

@Schema({ timestamps: true, collection: 'source_campaigns' })
export class SourceCampaign extends Document {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ enum: LeadSource, required: true })
  source: LeadSource;

  @Prop({ type: Types.ObjectId, ref: 'LeadStage', required: true })
  defaultStageId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Pool', required: true })
  defaultPoolId: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const SourceCampaignSchema = SchemaFactory.createForClass(SourceCampaign);
