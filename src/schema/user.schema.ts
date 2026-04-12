import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROBATION = 'probation',
  RESIGNED = 'resigned',
}

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, index: true })
  employeeId:number;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  number: string;

  @Prop({ required: true })
  password: string;

  @Prop({ enum: UserStatus, default: UserStatus.INACTIVE })
  status: UserStatus;

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop()
  lastLoginAt: Date;

  @Prop({ default: false })
  isDashboardEnabled: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Role' })
  role: Types.ObjectId;

  @Prop()
  otp: string;

  @Prop({default:false})
  IVREnabled:boolean

  @Prop()
  CallerIds:number[];
  
  @Prop()
  otpExpiry: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
