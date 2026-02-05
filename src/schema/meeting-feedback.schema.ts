import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class MeetingFeedback {
  @Prop({ type: Types.ObjectId, ref: 'MeetingLog', required: true })
  meetingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  feedback: string;
}

export const MeetingFeedbackSchema =
  SchemaFactory.createForClass(MeetingFeedback);
