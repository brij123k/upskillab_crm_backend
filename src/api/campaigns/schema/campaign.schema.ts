import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CampaignStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class WhatsappCampaign extends Document {
  @Prop({ required: true })
  campaignName: string;

  @Prop({ required: true })
  from: string;

  @Prop()
  templateName?: string;

  @Prop({
    enum: ['template', 'custom'],
    required: true,
  })
  campaignType: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  createdBy: Types.ObjectId;

  @Prop({
    enum: CampaignStatus,
    default: CampaignStatus.PENDING,
    index: true,
  })
  status: CampaignStatus;

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ default: 0 })
  pendingCount: number;

  @Prop({ type: Object })
  messageTemplate?: Record<string, any>;

  @Prop()
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const WhatsappCampaignSchema =
  SchemaFactory.createForClass(
    WhatsappCampaign,
  );

WhatsappCampaignSchema.index({
  createdBy: 1,
  createdAt: -1,
});

WhatsappCampaignSchema.index({
  createdBy: 1,
  status: 1,
});