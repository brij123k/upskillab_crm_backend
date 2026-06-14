import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';


@Schema({ _id: false })
class Address {
  @Prop()
  addressLine1?: string;

  @Prop()
  addressLine2?: string;

  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  country?: string;

  @Prop()
  pincode?: string;
}


@Schema({ _id: false })
class BankDetails {
  @Prop()
  accountHolderName?: string;

  @Prop()
  bankName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  ifscCode?: string;

  @Prop()
  branchName?: string;

  @Prop()
  accountType?: string;
}

@Schema({ _id: false })
class EducationDetail {
  @Prop()
  qualification?: string;

  @Prop()
  instituteName?: string;

  @Prop()
  boardOrUniversity?: string;

  @Prop()
  passingYear?: number;

  @Prop()
  percentageOrCGPA?: string;
}

@Schema({ _id: false })
class Documents {
  @Prop()
  aadhaarFront?: string;

  @Prop()
  aadhaarBack?: string;

  @Prop()
  panCard?: string;

  @Prop({
    type: [String],
    default: [],
  })
  educationalCertificates?: string[];
}

@Schema({ timestamps: true })
export class Profile extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Department' })
  departmentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reportingSeniorId?: Types.ObjectId;

  @Prop()
  education?: string;

  @Prop()
  salary?: number;

  @Prop()
  profileImage?: string;

 // ✅ UPDATED: multiple pools
  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Pool' }],
    default: [],
  })
  poolIds?: Types.ObjectId[];

  @Prop({
    type: [
      {
        module: String,
        actions: [String],
      },
    ],
    default: [],
  })
  extraAccessControls?: {
    module: string;
    actions: string[];
  }[];

  @Prop({ type: Address, default: {} })
  address?: Address;

  @Prop({ type: BankDetails, default: {} })
  bankDetails?: BankDetails;

  @Prop({
    type: [EducationDetail],
    default: [],
  })
  educationalDetails?: EducationDetail[];

  @Prop({ type: Documents, default: {} })
  documents?: Documents;
  
  createdAt: Date;
  updatedAt: Date;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);