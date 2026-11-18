import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum LeadSource {
  FACEBOOK = 'facebook',
  WEBSITE = 'website',
  GOOGLE = 'google',
  MANUAL = 'manual',
  POSITIVE = 'positive',
  REFURBISHED = 'refurbished',
  API = 'api',
  BOOTCAMP = 'bootcamp',
}

export enum LeadStatus {
  ACTIVE = 'active',
  LOST = 'lost',
  CONVERTED = 'converted',
  PCAT_REGISTERED = 'pcat_registered',
}

@Schema({ timestamps: true })
export class Lead extends Document {

  @Prop({ unique: true, index: true })
  leadId: number;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone: string;

  @Prop()
  email?: string;
  
  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop({ enum: LeadSource, required: true, default: LeadSource.MANUAL })
  source: LeadSource;


  // @Prop({ type: Types.ObjectId, ref: 'Department', required: false })
  // departmentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop({type:Date})
  assignedDate?:Date;

  @Prop({ type: Types.ObjectId, ref: 'LeadStage', required: true })
  stageId: Types.ObjectId;

  @Prop()
  stageChangedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Pool', required: true })
  poolId: Types.ObjectId;

  @Prop({ enum: LeadStatus, default: LeadStatus.ACTIVE })
  status: LeadStatus;

  @Prop({ default: 0 })
  healthScore: number;

  @Prop()
  lastActivityAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  modifiedBy?: Types.ObjectId;

  @Prop()
  modifiedAt?: Date;

  @Prop()
  leadHistory?: string

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  source_campaign?: string;

  /** Time of the latest call log for this lead (kept in sync by a CallLog hook). */
  @Prop({ type: Date })
  lastCallAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Column sorting on the Leads table.
LeadSchema.index({ lastCallAt: -1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ source_campaign: 1 });
