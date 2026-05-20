import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'source_campaign_logs' })
export class SourceCampaignLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'SourceCampaign', required: true })
  sourceCampaignId: Types.ObjectId;

  @Prop({ required: true })
  sourceCampaignName: string;

  @Prop({ required: true })
  source: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead', required: true })
  leadId: Types.ObjectId;

  @Prop()
  leadName?: string;

  @Prop()
  leadPhone?: string;

  @Prop()
  leadEmail?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SourceCampaignLogSchema = SchemaFactory.createForClass(SourceCampaignLog);
