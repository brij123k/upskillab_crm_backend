import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TargetMetricKey = 'calls' | 'meets' | 'pcatDone' | 'registrationDone' | 'revenue' | 'tasks';

@Schema({ timestamps: true })
export class Target extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  monthKey: string;

  @Prop({
    type: {
      calls: { type: Number, default: 0 },
      meets: { type: Number, default: 0 },
      pcatDone: { type: Number, default: 0 },
      registrationDone: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
      tasks: { type: Number, default: 0 },
    },
    default: {},
  })
  targets: Record<TargetMetricKey, number>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  @Prop()
  copiedFromMonthKey?: string;

  @Prop({ type: Types.ObjectId, ref: 'Target' })
  copiedFromTargetId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const TargetSchema = SchemaFactory.createForClass(Target);
TargetSchema.index({ userId: 1, monthKey: 1 }, { unique: true });
