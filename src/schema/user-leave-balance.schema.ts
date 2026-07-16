import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({
  timestamps: true,
})
export class UserLeaveBalance extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Role',
    required: true,
    index: true,
  })
  roleId: Types.ObjectId;

  /**
   * Balance Year
   */
  @Prop({
    required: true,
    index: true,
  })
  year: number;

  /**
   * Current Available CL
   */
  @Prop({
    default: 0,
    min: 0,
  })
  availableCL: number;

  /**
   * Current Available EL
   */
  @Prop({
    default: 0,
    min: 0,
  })
  availableEL: number;

  /**
   * Total EL carried from previous year
   */
  @Prop({
    default: 0,
    min: 0,
  })
  carriedForwardEL: number;

  /**
   * Total EL encashed
   */
  @Prop({
    default: 0,
    min: 0,
  })
  encashedEL: number;

  /**
   * Last Month Credited
   *
   * Used to prevent duplicate monthly credit.
   *
   * Example:
   *
   * January -> 1
   * February -> 2
   */
  @Prop({
    default: 0,
    min: 0,
    max: 12,
  })
  lastCreditedMonth: number;

  /**
   * Whether year-end process already completed
   */
  @Prop({
    default: false,
  })
  yearClosed: boolean;

  @Prop({
    default: true,
  })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const UserLeaveBalanceSchema =
  SchemaFactory.createForClass(UserLeaveBalance);

/**
 * One balance document per user per year
 */
UserLeaveBalanceSchema.index(
  {
    userId: 1,
    year: 1,
  },
  {
    unique: true,
  },
);