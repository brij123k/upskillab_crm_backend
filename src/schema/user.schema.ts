import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROBATION = 'probation',
  RESIGNED = 'resigned',
}

export enum OnboardingStatus {
  NOT_SHARED = 'not_shared',
  PENDING = 'pending', // link shared, waiting for employee
  SUBMITTED = 'submitted', // employee submitted, waiting for review
  APPROVED = 'approved', // reviewed & approved by admin / bd
}

@Schema({ _id: false })
export class Onboarding {
  @Prop({ index: true, sparse: true })
  token?: string;

  @Prop({ enum: OnboardingStatus, default: OnboardingStatus.NOT_SHARED })
  status: OnboardingStatus;

  @Prop({ default: false })
  linkActive: boolean;

  @Prop()
  sharedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  sharedBy?: Types.ObjectId;

  @Prop()
  submittedAt?: Date;

  @Prop({ default: 0 })
  submissionCount: number;

  @Prop()
  approvedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;
}

export const OnboardingSchema = SchemaFactory.createForClass(Onboarding);

@Schema({ timestamps: true })
export class 
User extends Document {
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

  @Prop({ type: OnboardingSchema, default: () => ({}) })
  onboarding: Onboarding;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
