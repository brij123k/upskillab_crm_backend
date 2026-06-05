import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class LeavePolicy extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Role', required: true, unique: true, index: true })
  roleId: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  casualLeavePerMonth: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  earnedLeavePerYear: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  earnedLeaveCarryForwardCap: number;

  @Prop({ type: Boolean, default: true })
  allowEarnedLeaveCarryForward: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const LeavePolicySchema = SchemaFactory.createForClass(LeavePolicy);
