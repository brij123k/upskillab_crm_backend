import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class PerformanceWarning extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  type: string;

  @Prop({ required: true })
  notes: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  issuedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const PerformanceWarningSchema =
  SchemaFactory.createForClass(PerformanceWarning);
