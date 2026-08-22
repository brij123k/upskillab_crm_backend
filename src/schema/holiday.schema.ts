import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Holiday extends Document {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);

// One holiday per date
HolidaySchema.index({ date: 1 }, { unique: true });