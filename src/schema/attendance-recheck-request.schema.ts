import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum AttendanceRecheckStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class AttendanceRecheckRequest extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'Attendance',
    required: true,
    index: true,
  })
  attendanceId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  requestedBy: Types.ObjectId;

  @Prop({
    required: true,
  })
  requestedStatus: string;

  @Prop({
    required: true,
  })
  requestReason: string;

  @Prop({
    enum: AttendanceRecheckStatus,
    default: AttendanceRecheckStatus.PENDING,
    index: true,
  })
  status: AttendanceRecheckStatus;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
  })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  reviewRemark?: string;

  @Prop()
  rejectedReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AttendanceRecheckRequestSchema =
  SchemaFactory.createForClass(
    AttendanceRecheckRequest,
  );

AttendanceRecheckRequestSchema.index(
  {
    attendanceId: 1,
    requestedBy: 1,
    status: 1,
  },
);