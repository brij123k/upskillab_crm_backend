import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum LeaveType {
  CL = 'CL',
  EL = 'EL',
}

@Schema({ timestamps: true })
export class LeaveRequest extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reportToUserId: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  reportToUserIds: Types.ObjectId[];

  @Prop({ required: true })
  subject: string;

  @Prop({ enum: LeaveType, default: LeaveType.CL, index: true })
  leaveType: LeaveType;

  @Prop({ required: true })
  leaveFrom: Date;

  @Prop()
  leaveTo?: Date;

  @Prop()
  leaveDate?: Date;

  @Prop({ required: true })
  reason: string;

  @Prop({ enum: LeaveStatus, default: LeaveStatus.PENDING, index: true })
  status: LeaveStatus;

  @Prop()
  approvalReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;


  @Prop({
  type: Types.ObjectId,
  ref: 'User',
})
cancelledBy?: Types.ObjectId;

@Prop()
cancelledAt?: Date;

@Prop()
cancelReason?: string;


  createdAt: Date;
  updatedAt: Date;
}

export const LeaveRequestSchema = SchemaFactory.createForClass(LeaveRequest);
