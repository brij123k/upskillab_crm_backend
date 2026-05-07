import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum AnnouncementAudience {
  ALL = 'all',
  SELECTED_USERS = 'selected_users',
  DEPARTMENT = 'department',
}

@Schema({ timestamps: true })
export class Announcement extends Document {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ enum: AnnouncementAudience, required: true })
  audience: AnnouncementAudience;

  @Prop({ type: Types.ObjectId, ref: 'Department', default: null })
  departmentId?: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  userIds?: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  recipientUserIds?: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
