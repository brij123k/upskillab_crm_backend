import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class LeadStage extends Document {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  order: number;

  @Prop({ type: Types.ObjectId, ref: 'Department', required: true,default: '698be171df217601cf5c22b9' })
  departmentId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}


export const LeadStageSchema =
  SchemaFactory.createForClass(LeadStage);
