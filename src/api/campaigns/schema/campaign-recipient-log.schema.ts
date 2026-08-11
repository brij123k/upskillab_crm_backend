import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CampaignRecipientStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class CampaignRecipientLog extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'WhatsappCampaign',
    required: true,
    index: true,
  })
  campaignId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true,
  })
  leadId: Types.ObjectId;

  @Prop()
  leadName?: string;

  @Prop()
  phone?: string;

  @Prop({
    enum: CampaignRecipientStatus,
    default: CampaignRecipientStatus.PENDING,
    index: true,
  })
  status: CampaignRecipientStatus;

  // Actual WhatsApp message ID returned by UDO
  @Prop()
  messageId?: string;

  // Exact payload that was sent to UDO
  @Prop({ type: Object })
  messageSent?: Record<string, any>;

  // UDO response
  @Prop({ type: Object })
  providerResponse?: Record<string, any>;

  // Error returned by UDO/backend
  @Prop()
  error?: string;

  @Prop()
  sentAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  processingAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const CampaignRecipientLogSchema =
  SchemaFactory.createForClass(
    CampaignRecipientLog,
  );

// Useful for campaign log pagination/filtering
CampaignRecipientLogSchema.index({
  campaignId: 1,
  status: 1,
  createdAt: -1,
});

CampaignRecipientLogSchema.index({
  campaignId: 1,
  leadName: 1,
});

CampaignRecipientLogSchema.index({
  campaignId: 1,
  phone: 1,
});