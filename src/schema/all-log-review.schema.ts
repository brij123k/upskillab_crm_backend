import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CallLogReview extends Document {
  @Prop({ required: true })
  leadId: number;

  @Prop({ type: Types.ObjectId, ref: 'CallLog', required: true })
  callLogId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  remark: string;
}

export const CallLogReviewSchema =
  SchemaFactory.createForClass(CallLogReview);
