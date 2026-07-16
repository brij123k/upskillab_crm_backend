import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class LeavePolicy extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'Role',
    required: true,
    index: true,
  })
  roleId: Types.ObjectId;

  /**
   * Policy Year
   * Example: 2026, 2027
   */
  @Prop({
    required: true,
    index: true,
  })
  year: number;

  /**
   * Monthly Casual Leave
   */
  @Prop({
    required: true,
    default: 0,
    min: 0,
  })
  monthlyCL: number;

  /**
   * Monthly Earned Leave
   */
  @Prop({
    required: true,
    default: 0,
    min: 0,
  })
  monthlyEL: number;

  /**
   * Allow EL Carry Forward
   */
  @Prop({
    default: true,
  })
  allowEarnedLeaveCarryForward: boolean;

  /**
   * Allow EL Encashment
   */
  @Prop({
    default: true,
  })
  allowEarnedLeaveEncashment: boolean;

  /**
   * Maximum EL Carry Forward
   * 0 = Unlimited
   */
  @Prop({
    default: 0,
    min: 0,
  })
  maxCarryForwardEL: number;

  /**
   * Active Policy
   */
  @Prop({
    default: true,
  })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const LeavePolicySchema =
  SchemaFactory.createForClass(LeavePolicy);

/**
 * One policy per Role per Year
 */
LeavePolicySchema.index(
  {
    roleId: 1,
    year: 1,
  },
  {
    unique: true,
  },
);