import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Kra extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Role', required: true, unique: true, index: true })
  roleId: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  fullDayAnsweredCalls: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  fullDayTalkTime: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  fullDayDialCalls: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  fullDayBookings: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  fullDayDemoConducts: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  halfDayAnsweredCalls: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  halfDayTalkTime: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  halfDayDialCalls: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  halfDayBookings: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  halfDayDemoConducts: number;

  createdAt: Date;
  updatedAt: Date;
}

export const KraSchema = SchemaFactory.createForClass(Kra);
