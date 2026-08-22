import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum AttendanceStatus {
  PRESENT = 'present',
  LOGGEDIN = 'logged_in',
  HALF_DAY = 'half_day',
  ABSENT = 'absent',
  LEAVE = 'leave',
  LATE = 'late',
  WEEK_OFF = 'week_off',
  HOLIDAY = 'holiday',
  OTHER = 'other',
}

export enum AttendanceLeaveType {
  CL = 'CL',
  EL = 'EL',
}

@Schema({ timestamps: true })
export class Attendance extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  loginTime: Date;

  @Prop()
  logoutTime?: Date;

  @Prop({ default: 0 })
  workHours: number;

  @Prop({ enum: AttendanceStatus, default: AttendanceStatus.ABSENT })
  status: AttendanceStatus;

  @Prop({ enum: AttendanceLeaveType, required: false })
  leaveType?: AttendanceLeaveType;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop()
  reason?: string;

  @Prop({ type: Object, default: null })
  kraResult?: Record<string, any>;


  @Prop({ type: Types.ObjectId, ref: 'User' })
statusChangedBy?: Types.ObjectId;

@Prop()
statusChangedAt?: Date;

@Prop()
statusChangeRemark?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
